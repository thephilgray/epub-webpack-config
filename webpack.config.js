const path = require('path');
const fs = require('fs');
const CleanWebpackPlugin = require('clean-webpack-plugin');
const { xml2js, js2xml } = require('xml-js');
const chalk = require('chalk');

const { log } = console;

/**
 * Constants for testing
 * TODO: Some of these need to be determined dynamically or from config options
 */

const SRC_DIRECTORY = './src';
const OPF_PATH = './src/EPUB/content.opf';
const DIST_PATH = './dist/';
const OPF_DIRNAME = 'EPUB';
const OPF_DIST_DIRECTORY = './dist/EPUB/';
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
    compiler.hooks.done.tap('EPUB Plugin', (
      stats /* stats is passed as argument when done hook is tapped.  */
    ) => {
      const XML_JS_OPTIONS = {
        spaces: 2,
        compact: true,
        ignoreComment: true,
      };
      const PAGES_EXTENSION = 'xhtml';
      // Get data from source opf
      const xmlFromOpf = fs.readFileSync(OPF_PATH, 'utf8');
      const jsFromOpf = xml2js(xmlFromOpf, XML_JS_OPTIONS);

      // const manifestItemFromOpf = jsFromOpf.package.manifest;
      // const spineFromOpf = jsFromOpf.package.spine.itemref;

      const { assets } = stats.compilation;

      log(
        stats.compilation.fileDependencies._cache,
        Object.keys(stats.compilation.fileDependencies)
      );

      /**
       * TODO: Create an api for merging updates from assets
       *
       *  1. remove: filter out and log any src opf items that no longer exist in assets
       *  2. add: log and add new assets which were not found in the original opf
       *  3. update: when an item is found to exist in both the src opf and the assets, log and merge it
       *  4. getUpdatedOpf: return the updated opf object
       *
       * */

      //  TODO: merge metadata from a user-supplied config

      // TODO: handle properties
      // TODO: allow this list to be ordered and refined by a user-supplied config
      const manifestItemFromAssets = Object.keys(assets).map(asset => {
        const assetObj = assets[asset].existsAt;
        const { root, dir, base, ext, name } = path.parse(assetObj);
        return {
          _attributes: {
            href: path.relative(OPF_DIST_DIRECTORY, assetObj),
            id: name,
            'media-type': EXTS[ext.substr(1)],
          },
        };
      });

      // TODO: handle properties like linear
      // for now just get all xhtml pages
      // TODO: allow this list to be ordered and refined by a user-supplied config
      const spineFromAssets = manifestItemFromAssets
        .filter(
          ({ _attributes }) =>
            _attributes['media-type'] === EXTS[PAGES_EXTENSION]
        )
        .map(({ _attributes }) => ({ _attributes: { idref: _attributes.id } }));

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
            itemref: spineFromAssets.reverse(),
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
  name: `[hash].[ext]`,
};

module.exports = {
  entry: './index.js',
  output: {
    path: path.resolve(__dirname, OPF_DIST_DIRECTORY),
    filename: `js/[name].js`,
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
  ],
};
