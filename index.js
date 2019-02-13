// index.js
// TODO: allow pages extension to be set in user-supplied config to enable a templating language and ignore any standard partials/mixins/layouts/views/templates directories

function requireAll(r) {
  r.keys().forEach(r);
}
requireAll(require.context("./src/", true, /\.xhtml$/));
