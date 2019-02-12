const path = require("path");
const fs = require("fs");
const CleanWebpackPlugin = require("clean-webpack-plugin");
const AssetsPlugin = require("assets-webpack-plugin");
const chalk = require("chalk");
const { xml2json, json2xml } = require("xml-js");
const ejs = require("ejs");

const { log } = console;

const assetsPluginInstance = new AssetsPlugin({
  update: true,
  fileTypes: ["js", "jpg", "xhtml"]
});

const exts = {
  js: "application/javascript",
  css: "text/css",
  xhtml: "application/xhtml+xml",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  svg: "image/svg+xml",
  ttf: "application/font-sfnt",
  ttc: "application/font-sfnt",
  woff: "application/font-woff",
  woff2: "font/woff2",
  vtt: "text/vtt",
  xml: "application/xml",
  mp4: "video/mp4",
  mp3: "audio/mp3",
  m4a: "audio/m4a"
};

class EpubPlugin {
  apply(compiler) {
    compiler.hooks.done.tap("EPUB Plugin", (
      stats /* stats is passed as argument when done hook is tapped.  */
    ) => {
      fs.unlinkSync("./dist/out.js");
      log(chalk.red("delete dist/out.js"));
      const assets = stats.compilation.assets;
      const assetMap = Object.keys(assets).map(asset => {
        const assetObj = assets[asset].existsAt;
        const { root, dir, base, ext, name } = path.parse(assetObj);
        return {
          href: path.relative("./dist/", assetObj),
          id: name,
          "media-type": exts[ext.substr(1)]
        };
      });

      // log(assetMap);

      // old assets
      const xml = fs.readFileSync("./src/content.opf", "utf8");
      const json = xml2json(xml, { spaces: 2, compact: true });
      const parsedJson = JSON.parse(json);
      const manifest = parsedJson.package.manifest.item;

      // log(manifest);

      // old spine
      const spine = parsedJson.package.spine.itemref;
      log(spine);
      // // log(spine);

      // for now just get all xhtml pages
      const spinePages = assetMap
        .filter(asset => asset["media-type"] === "application/xhtml+xml")
        .map(item => ({ _attributes: { idref: item.id } }));

      log(spinePages);

      // update old assets with new assets

      // const updatedJson = {
      //   ...json,
      //   package: {
      //     ...json.package,
      //     spine: { toc: "toc", itemref: { ...spinePages } },
      //     manifest: { item: assetMap }
      //   }
      // };
      // log(updatedJson);
      // const updatedXml = json2xml(updatedJson);

      // log(updatedJson.package.manifest.item);

      // fs.writeFileSync("./dist/content.opf", updatedXml);
      // or use a template
      // ejs.renderFile(
      //   "./templates/content.ejs",
      //   { items: assetMap, pages: spinePages },
      //   {},
      //   (err, str) => {
      //     if (err) return log(err);
      //     fs.writeFileSync("./dist/content.opf", str);
      //   }
      // );
    });
  }
}

module.exports = {
  entry: "./index.js",
  output: {
    filename: "out.js",
    path: path.resolve(__dirname, "dist")
  },
  module: {
    rules: [
      {
        test: /\.xhtml$/,
        use: [
          "file-loader",
          "extract-loader",
          {
            loader: "html-loader",
            options: {
              attrs: ["img:src", "link:href", "audio:src"]
            }
          }
        ]
      },
      {
        test: /\.css$/,
        use: [
          "file-loader",
          "extract-loader",
          {
            loader: "css-loader"
          }
        ]
      },
      {
        test: /\.mp3$/,
        use: ["file-loader"]
      },
      {
        test: /\.(png|jpg|gif)$/,
        use: [
          {
            loader: "file-loader"
          }
        ]
      },
      {
        test: /\.(woff(2)?|ttf|eot|svg)(\?v=\d+\.\d+\.\d+)?$/,
        use: [
          {
            loader: "file-loader"
          }
        ]
      }
    ]
  },
  plugins: [
    assetsPluginInstance,
    new CleanWebpackPlugin(["dist"]),
    new EpubPlugin({ options: true })
  ]
};
