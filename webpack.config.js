const path = require('path');
const fs = require('fs-extra');
const { promisify } = require('util');
const CleanWebpackPlugin = require('clean-webpack-plugin');
const { xml2js, js2xml } = require('xml-js');
const chalk = require('chalk');
const glob = require('glob');
const ManifestPlugin = require('webpack-manifest-plugin');
const invert = require('lodash/invert');

const { log } = console;
const promiseGlob = promisify(glob);

module.exports = async () => {
  /**
   * Constants for testing
   * TODO: Some of these need to be determined dynamically or from config options
   */
  const SRC_DIRECTORY = './src';
  const DIST_PATH = './dist';
  const PAGES_EXTENSION = 'xhtml';

  /** TODO: add a fallback to generate the OPF file from template, in case one hasn't been supplied */
  const opf = await promiseGlob(`${SRC_DIRECTORY}/**/*.opf`);
  const OPF_PATH = opf[0] || SRC_DIRECTORY;
  // assign a default name OEBPS in case one was not included
  const OPF_DIRNAME =
    path.dirname(OPF_PATH) === SRC_DIRECTORY
      ? 'OEBPS'
      : path.relative(SRC_DIRECTORY, path.dirname(OPF_PATH));

  const OPF_DIST_DIRECTORY = `./${path.join(DIST_PATH, OPF_DIRNAME)}`;

  const EXTS = {
    js: 'application/javascript',
    css: 'text/css',
    xhtml: 'application/xhtml+xml',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    ttf: 'application/font-sfnt',
    ttc: 'application/font-sfnt',
    woff: 'application/font-woff',
    woff2: 'font/woff2',
    vtt: 'text/vtt',
    xml: 'application/xml',
    mp4: 'video/mp4',
    mp3: 'audio/mp3',
    m4a: 'audio/m4a',
  };

  class EpubPlugin {
    constructor(options) {
      this.options = {
        ...{
          /** defaults */
        },
        ...options,
      };
    }
    // eslint-disable-next-line
    apply(compiler) {
      compiler.hooks.done.tap('EPUB Plugin', async (
        stats /* stats is passed as argument when done hook is tapped.  */
      ) => {
        const XML_JS_OPTIONS = {
          spaces: 2,
          compact: true,
          ignoreComment: true,
        };

        // TODO: handle cases in which the src code does not include an opf
        // Get data from source opf
        const xmlFromOpf = fs.readFileSync(OPF_PATH, 'utf8');
        const jsFromOpf = xml2js(xmlFromOpf, XML_JS_OPTIONS);

        const manifestItemFromOpf = jsFromOpf.package.manifest.item;
        const spineFromOpf = jsFromOpf.package.spine.itemref;

        const { assets } = stats.compilation;

        // log(
        //   stats.compilation.fileDependencies,
        //   Object.keys(stats.compilation.fileDependencies)
        // );

        /**
         * TODO: Create an api for merging updates from assets
         *
         *  1. remove: filter out and log any src opf items that no longer exist in assets
         *  2. add: log and add new assets which were not found in the original opf
         *  3. update: when an item is found to exist in both the src opf and the assets, log and merge it
         *  4. getUpdatedOpf: return the updated opf object
         *
         * */

        // original filenames mapped to new filenames
        // TODO: is there any way to get this data without relying on the manifest plugin and writing to file?
        const manifestMap = fs.readJSONSync(
          path.resolve(process.cwd(), 'manifest.json')
        );

        // TODO: use it!
        // create a more useful manifestMap: {[hashed-filename]: { href: '', filename: '', id: '', hashedId: '' }}
        // const betterManifestMap = Object.keys(manifestMap).reduce(
        //   (acc, curr) => {
        //     const existingItem = manifestItemFromOpf.find(({ _attributes }) => {
        //       const { base } = path.parse(_attributes.href);
        //       return base === curr;
        //     });
        //     // include more information about the item used in content.opf, including its original id
        //     acc[manifestMap[curr]] = {
        //       href: existingItem ? existingItem._attributes.href : curr,
        //       filename: existingItem
        //         ? path.basename(existingItem._attributes.href)
        //         : curr,
        //       id: existingItem ? existingItem._attributes.id : curr,
        //       hashedId: manifestMap[curr].split('.').shift(),
        //     };
        //     return acc;
        //     // const {base} = path.parse();
        //   },
        //   {}
        // );

        const opfManifestItemAttributesMap = manifestItemFromOpf.reduce(
          (acc, curr) => {
            const { base } = path.parse(
              path.resolve(OPF_DIRNAME, curr._attributes.href)
            );
            acc[base] = curr._attributes;
            return acc;
          },
          {}
        );

        const opfSpineItemAttributesMap = spineFromOpf.reduce((acc, curr) => {
          acc[curr._attributes.idref] = curr._attributes;
          return acc;
        }, {});

        // TODO: allow this list to be ordered and refined by a user-supplied config, merging over it again
        // TODO: filter out generated files like main.js (unless js is required) and manifest

        const manifestItemFromAssets = Object.keys(assets).map(asset => {
          const assetObj = assets[asset].existsAt;
          const { base, ext, name } = path.parse(assetObj);
          // invert manifestMap so that the new filename is the key and the old filename is the value
          const manifestMapId = invert(manifestMap)[base];
          // the attributes for the item from the source opf
          const oldAttributes = opfManifestItemAttributesMap[manifestMapId];

          return {
            _attributes: {
              ...oldAttributes,
              href: path.relative(OPF_DIST_DIRECTORY, assetObj),
              id: name,
              'media-type': EXTS[ext.substr(1)],
            },
          };
        });

        // for now just get all xhtml pages
        // TODO: allow this list to be ordered and refined by a user-supplied config
        // TODO: order alpha and then by original order and then by user-supplied
        const spineFromAssets = manifestItemFromAssets
          .filter(
            ({ _attributes }) =>
              _attributes['media-type'] === EXTS[PAGES_EXTENSION]
          )
          .map(({ _attributes }) => {
            // the same technique used to merge the manifest items but this time to lookup the original properties, we must first get the id from the corresponding manifest item
            const { base } = path.parse(_attributes.href);
            const manifestMapId = invert(manifestMap)[base];
            const spineIdref = opfManifestItemAttributesMap[manifestMapId].id;
            const oldAttributes = opfSpineItemAttributesMap[spineIdref];

            return { _attributes: { ...oldAttributes, idref: _attributes.id } };
          });

        // merge manifestItemFromAssets and spineFromAssets into the the new opf
        const updatedOpf = {
          ...jsFromOpf,
          package: {
            ...jsFromOpf.package,
            manifest: {
              item: manifestItemFromAssets,
            },
            spine: {
              ...jsFromOpf.package.spine,
              itemref: spineFromAssets,
            },
          },
        };

        const updatedOpfXml = js2xml(updatedOpf, XML_JS_OPTIONS);

        fs.writeFileSync(`${OPF_DIST_DIRECTORY}/content.opf`, updatedOpfXml);
      });
    }
  }

  const LOADER_OPTIONS = {
    // name: '[folder]/[name].[ext]',
    // context ensures that 'src' isn't output as part of the path
    context: OPF_DIST_DIRECTORY,
    name: `[hash]_[name].[ext]`,
  };

  return {
    entry: './index.js',
    output: {
      path: path.resolve(__dirname, OPF_DIST_DIRECTORY),
      filename: `[name].js`,
    },
    module: {
      rules: [
        // TODO: handle templating languages
        {
          test: /\.xhtml$/,
          use: [
            {
              loader: 'file-loader',
              options: LOADER_OPTIONS,
            },
            'extract-loader',
            {
              loader: 'html-loader',
              options: {
                attrs: ['img:src', 'link:href', 'audio:src'],
              },
            },
          ],
        },
        // TODO: handle preprocessors
        {
          test: /\.css$/,
          use: [
            {
              loader: 'file-loader',
              options: LOADER_OPTIONS,
            },
            'extract-loader',
            {
              loader: 'css-loader',
            },
          ],
        },
        {
          test: /\.mp3$/,
          use: [
            {
              loader: 'file-loader',
              options: LOADER_OPTIONS,
            },
          ],
        },
        // TODO: optionally optimize images
        {
          test: /\.(png|jpg|gif)$/,
          use: [
            {
              loader: 'file-loader',
              options: LOADER_OPTIONS,
            },
          ],
        },
        {
          test: /\.(woff(2)?|ttf|eot|svg)(\?v=\d+\.\d+\.\d+)?$/,
          use: [
            {
              loader: 'file-loader',
              options: LOADER_OPTIONS,
            },
          ],
        },
      ],
    },
    plugins: [
      new CleanWebpackPlugin([DIST_PATH]),
      new EpubPlugin({ options: true }),
      new ManifestPlugin({
        fileName: path.resolve(SRC_DIRECTORY, '..', 'manifest.json'),
      }),
    ],
  };
};
