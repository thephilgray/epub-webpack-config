const path = require('path');
const fs = require('fs');
const CleanWebpackPlugin = require('clean-webpack-plugin');
const { xml2js, js2xml } = require('xml-js');
const chalk = require('chalk');

const { log } = console;

const exts = {
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
  // eslint-disable-next-line
  apply(compiler) {
    compiler.hooks.done.tap('EPUB Plugin', (
      stats /* stats is passed as argument when done hook is tapped.  */
    ) => {
      const OPF_PATH = './src/content.opf';
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
            href: path.relative('./dist/', assetObj),
            id: name,
            'media-type': exts[ext.substr(1)],
          },
        };
      });

      // TODO: handle properties like linear
      // for now just get all xhtml pages
      // TODO: allow this list to be ordered and refined by a user-supplied config
      const spineFromAssets = manifestItemFromAssets
        .filter(
          ({ _attributes }) =>
            _attributes['media-type'] === exts[PAGES_EXTENSION]
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
            itemref: spineFromAssets,
          },
        },
      };

      const updatedOpfXml = js2xml(updatedOpf, XML_JS_OPTIONS);

      fs.writeFileSync('./dist/content.opf', updatedOpfXml);
    });
  }
}

module.exports = {
  entry: './index.js',
  output: {
    filename: 'out.js',
    path: path.resolve(__dirname, 'dist'),
  },
  module: {
    rules: [
      {
        test: /\.xhtml$/,
        use: [
          'file-loader',
          'extract-loader',
          {
            loader: 'html-loader',
            options: {
              attrs: ['img:src', 'link:href', 'audio:src'],
            },
          },
        ],
      },
      {
        test: /\.css$/,
        use: [
          'file-loader',
          'extract-loader',
          {
            loader: 'css-loader',
          },
        ],
      },
      {
        test: /\.mp3$/,
        use: ['file-loader'],
      },
      {
        test: /\.(png|jpg|gif)$/,
        use: [
          {
            loader: 'file-loader',
          },
        ],
      },
      {
        test: /\.(woff(2)?|ttf|eot|svg)(\?v=\d+\.\d+\.\d+)?$/,
        use: [
          {
            loader: 'file-loader',
          },
        ],
      },
    ],
  },
  plugins: [
    new CleanWebpackPlugin(['dist']),
    new EpubPlugin({ options: true }),
  ],
};
