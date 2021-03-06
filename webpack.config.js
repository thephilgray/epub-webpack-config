const path = require('path');
const fs = require('fs-extra');
const { promisify } = require('util');
const CleanWebpackPlugin = require('clean-webpack-plugin');
const { xml2js, js2xml } = require('xml-js');
const chalk = require('chalk');
const glob = require('glob');
const ManifestPlugin = require('webpack-manifest-plugin');
const invert = require('lodash/invert');
const ejs = require('ejs');
const { getTocDataFromArrayOfHtmlPathsOrStrings } = require('toc-generator');

const { log } = console;
const promiseGlob = promisify(glob);
const promiseEjsRender = promisify(ejs.render);

module.exports = async () => {
  /**
   * Constants for testing
   * TODO: Some of these need to be determined dynamically or from config options
   */
  const SRC_DIRECTORY = './src';
  const DIST_PATH = './build';
  const PAGES_EXTENSION = 'xhtml';
  const TEMPLATE_PATH = './templates';

  const opf = await promiseGlob(`${SRC_DIRECTORY}/**/*.opf`);
  /** add a fallback to generate the OPF file from template, in case one hasn't been supplied */
  const SRC_OPF_EXISTS = Boolean(opf[0]);
  const OPF_PATH = opf[0] || SRC_DIRECTORY;
  // assign a default name OEBPS in case one was not included
  const OPF_DIRNAME =
    path.dirname(OPF_PATH) === SRC_DIRECTORY || !SRC_OPF_EXISTS
      ? 'OEBPS'
      : path.relative(SRC_DIRECTORY, path.dirname(OPF_PATH));

  const OPF_DIST_DIRECTORY = `./${path.join(DIST_PATH, OPF_DIRNAME)}`;

  // filter out generated files like main.js (unless js is required) and manifest
  const FILTERED = ['manifest.json', 'main.js'];

  const TOC_LEVELS = 2;

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
    ncx: 'application/x-dtbncx+xml'
  };

  class EpubPlugin {
    constructor(options) {
      this.options = {
        ...{
          /** defaults */
        },
        ...options
      };
    }

    // TODO: make a general method for returning a new opf
    getUpdatedOpf(oldOpf, payload) {}

    // eslint-disable-next-line
    apply(compiler) {
      // TODO: move some of the done code to emit or another hook before done; where we can compile to template before writing

      compiler.hooks.done.tap('EPUBPlugin', async (
        stats /* stats is passed as argument when done hook is tapped.  */
      ) => {
        const XML_JS_OPTIONS = {
          spaces: 2,
          compact: true,
          ignoreComment: true
        };

        // Get data from source opf
        // if there's no opf included, read it from template
        const xmlFromOpf = SRC_OPF_EXISTS
          ? fs.readFileSync(OPF_PATH, 'utf8')
          : fs.readFileSync(path.resolve(TEMPLATE_PATH, 'content.opf'));

        const jsFromOpf = xml2js(xmlFromOpf, XML_JS_OPTIONS); // type object

        const manifestItemFromOpf = jsFromOpf.package.manifest.item
          ? [].concat(jsFromOpf.package.manifest.item)
          : []; // must be type array

        const spineFromOpf = jsFromOpf.package.spine.itemref
          ? [].concat(jsFromOpf.package.spine.itemref)
          : []; // must be type array

        // TODO: create another opf object from data.json or data.yaml which merges after opf

        const { assets } = stats.compilation;

        // log(
        //   stats.compilation.fileDependencies,
        //   Object.keys(stats.compilation.fileDependencies)
        // );

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

        /* TODO: improve and or combine maps */

        const createManifestMap = manifestItem =>
          manifestItem.reduce((acc, curr) => {
            const { base } = path.parse(
              path.resolve(OPF_DIRNAME, curr._attributes.href)
            );
            acc[base] = curr._attributes;
            return acc;
          }, {});

        const createSpineItemMap = spineItemref =>
          spineItemref.reduce((acc, curr) => {
            acc[curr._attributes.idref] = curr._attributes;
            return acc;
          }, {});

        const opfManifestItemAttributesMap = createManifestMap(
          manifestItemFromOpf
        );

        const opfSpineItemAttributesMap = createSpineItemMap(spineFromOpf);

        // TODO: allow this list to be ordered and refined by a user-supplied config, merging over it again

        const manifestItemFromAssets = Object.keys(assets)
          .filter(asset => FILTERED.indexOf(path.basename(asset)) < 0)
          .map(asset => {
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
                'media-type': EXTS[ext.substr(1)]
              }
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
            const spineIdref = opfManifestItemAttributesMap[manifestMapId]
              ? opfManifestItemAttributesMap[manifestMapId].id
              : null;
            const oldAttributes = opfSpineItemAttributesMap[spineIdref] || {};

            return { _attributes: { ...oldAttributes, idref: _attributes.id } };
          });

        // TODO: create a function that takes a payload and returns the updatedOpf

        // merge manifestItemFromAssets and spineFromAssets into the the new opf
        const updatedOpf = {
          ...jsFromOpf,
          package: {
            ...jsFromOpf.package,
            manifest: {
              item: manifestItemFromAssets
            },
            spine: {
              ...jsFromOpf.package.spine,
              itemref: spineFromAssets
            }
          }
        };

        /* addFile */

        /**
         *
         * Scaffolding - can be async
         *
         */

        // TODO: if there's no nav, we need to generate one and add it to assets

        const updatedManifest = [].concat(updatedOpf.package.manifest.item);
        const updatedSpine = [].concat(updatedOpf.package.spine.itemref);
        const updatedTitle = updatedOpf.package.metadata['dc:title']._text;
        const updatedIdentifier =
          updatedOpf.package.metadata['dc:identifier']._text;

        const isNav =
          updatedManifest.filter(
            item =>
              item._attributes &&
              item._attributes.properties &&
              item._attributes.properties.split(' ').indexOf('nav') > -1
          ).length > 0;

        if (!isNav) {
          log('nav not detected');
          // compile toc.ncx and toc.xhtml from template, sending data {title: '', identifier: '', pages: [{order: 1, level: 1, title: '', href: ''}]}
          // get pages from spine and construct data for template
          let tocItemIncrement = 1;
          const pagesMapPromise = updatedManifest.reduce(
            async (acc, curr, i) => {
              const resolvedAcc = await acc;
              const fileExistsInSpine = id =>
                updatedSpine.filter(
                  spineItem => spineItem._attributes.idref === id
                ).length === 1;
              if (!fileExistsInSpine(curr._attributes.id)) {
                return resolvedAcc;
              }

              // get the index of the current manifest item from the spine
              // const order =
              //   updatedSpine.findIndex(
              //     item => item._attributes.idref === curr._attributes.id
              //   ) + tocItemIncrement;

              const pageTocData = await getTocDataFromArrayOfHtmlPathsOrStrings(
                [].concat(assets[curr._attributes.href]._value.toString()),
                TOC_LEVELS
              );

              const page = pageTocData.map(heading => {
                const order = tocItemIncrement++;
                return {
                  href: heading.id
                    ? `${curr._attributes.href}#${heading.id}`
                    : curr._attributes.href,
                  order,
                  title: heading.text,
                  level: heading.level
                };
              });

              // TODO: include pages even if there are no headings; should be optional

              return [...resolvedAcc, ...page];
            },
            Promise.resolve([])
          );

          const pagesMap = await pagesMapPromise;

          const tocData = {
            title: updatedTitle,
            identifier: updatedIdentifier,
            pages: pagesMap
          };

          // render templates
          const renderedTocNcx = await ejs.renderFile(
            `${TEMPLATE_PATH}/toc.ncx.ejs`,
            tocData,
            { async: true }
          );
          const renderedTocXhtml = await ejs.renderFile(
            `${TEMPLATE_PATH}/toc.xhtml.ejs`,
            tocData,
            { async: true }
          );

          // write files
          await fs.writeFile(`${OPF_DIST_DIRECTORY}/toc.ncx`, renderedTocNcx);
          log(`${OPF_DIST_DIRECTORY}/toc.ncx written`);
          await fs.writeFile(
            `${OPF_DIST_DIRECTORY}/toc.xhtml`,
            renderedTocXhtml
          );
          log(`${OPF_DIST_DIRECTORY}/toc.xhtml written`);

          // mutate the updated manifest before it gets written
          const manifestTocXhtmlItem = {
            _attributes: {
              href: 'toc.xhtml',
              id: 'toc',
              'media-type': 'application/xhtml+xml',
              properties: 'nav'
            }
          };

          const manifestTocNcxItem = {
            _attributes: {
              href: 'toc.ncx',
              id: 'ncx',
              'media-type': 'application/x-dtbncx+xml'
            }
          };
          updatedOpf.package.manifest.item.push(manifestTocXhtmlItem);
          updatedOpf.package.manifest.item.push(manifestTocNcxItem);
          // mutate the spine to include the toc property
          updatedOpf.package.spine._attributes = { toc: 'ncx' };
        }

        const updatedOpfXml = js2xml(updatedOpf, XML_JS_OPTIONS);
        // create the directory if it hasn't been emitted by webpack yet
        await fs.ensureDir(OPF_DIST_DIRECTORY);
        await fs.writeFile(`${OPF_DIST_DIRECTORY}/content.opf`, updatedOpfXml);
        log(`${OPF_DIST_DIRECTORY}/content.opf written`);

        // copy or generate the mimetype and META-INF/container.xml
        const mimetype = await promiseGlob(`${SRC_DIRECTORY}/mimetype`);
        const containerxml = await promiseGlob(
          `${SRC_DIRECTORY}/META-INF/container.xml`
        );
        const srcMimetypeExists = Boolean(mimetype[0]);
        const srcContainerXmlExists = Boolean(containerxml[0]);

        /* if the mimetype exists in source, just copy it to dist; otherwise, write it to dist */

        fs.ensureDirSync(DIST_PATH);
        if (srcMimetypeExists) {
          await fs.copyFile(mimetype[0], `${DIST_PATH}/mimetype`);
        } else {
          await fs.writeFile(`${DIST_PATH}/mimetype`, 'application/epub+zip');
          log(`${DIST_PATH}/mimetype written`);
        }

        /* if the container.xml file exists in source, copy it to dist; otherwise, compile and write it from templates */

        await fs.ensureDir(`${DIST_PATH}/META-INF/`);
        if (srcContainerXmlExists) {
          await fs.copyFile(
            containerxml[0],
            `${DIST_PATH}/META-INF/container.xml`
          );
        } else {
          const renderedContainerXml = await ejs.renderFile(
            `${TEMPLATE_PATH}/container.ejs`,
            {
              RELATIVE_OPF_PATH: path.relative(
                DIST_PATH,
                `${OPF_DIST_DIRECTORY}/content.opf`
              )
            },
            { async: true }
          );
          await fs.writeFile(
            `${DIST_PATH}/META-INF/container.xml`,
            renderedContainerXml
          );
          log(`${DIST_PATH}/META-INF/container.xml written`);
        }

        /* hack: delete filtered files */
        // TODO: Hopefully there's a webpack way to remove these from bundling
        glob(
          `/**/*/{${FILTERED.join(',')}}`,
          { root: DIST_PATH },
          (err, files) => {
            files.forEach(file => {
              if (!fs.pathExistsSync(file)) return;
              fs.unlinkSync(file);
            });
          }
        );

        /*=====  End of Scaffold Function  ======*/
      });
    }
  }

  const LOADER_OPTIONS = {
    // name: '[folder]/[name].[ext]',
    // context ensures that 'src' isn't output as part of the path
    context: OPF_DIST_DIRECTORY,
    name: `[name].[ext]`
  };

  return {
    entry: './index.js',
    output: {
      path: path.resolve(__dirname, OPF_DIST_DIRECTORY),
      filename: `[name].js`
    },
    module: {
      rules: [
        // TODO: handle templating languages
        {
          test: /\.xhtml$/,
          use: [
            {
              loader: 'file-loader',
              options: LOADER_OPTIONS
            },
            'extract-loader',
            {
              loader: 'html-loader',
              options: {
                attrs: ['img:src', 'link:href', 'audio:src']
              }
            }
          ]
        },
        // TODO: handle preprocessors
        {
          test: /\.css$/,
          use: [
            {
              loader: 'file-loader',
              options: LOADER_OPTIONS
            },
            'extract-loader',
            {
              loader: 'css-loader'
            }
          ]
        },

        {
          test: /\.mp3$/,
          use: [
            {
              loader: 'file-loader',
              options: LOADER_OPTIONS
            }
          ]
        },
        // TODO: optionally optimize images
        {
          test: /\.(png|jpg|gif)$/,
          use: [
            {
              loader: 'file-loader',
              options: LOADER_OPTIONS
            }
          ]
        },
        {
          test: /\.(woff(2)?|ttf|eot|svg)(\?v=\d+\.\d+\.\d+)?$/,
          use: [
            {
              loader: 'file-loader',
              options: LOADER_OPTIONS
            }
          ]
        }
      ]
    },
    plugins: [
      new CleanWebpackPlugin([DIST_PATH]),
      new EpubPlugin({ options: true }),
      new ManifestPlugin({
        fileName: path.resolve(SRC_DIRECTORY, '..', 'manifest.json')
      })
    ]
  };
};
