const { series, src, watch, dest } = require("gulp");
const gls = require("gulp-live-server");
const dotenv = require("rollup-plugin-dotenv").default;
const rollup = require("rollup");
const fs = require("fs");
const path = require("path");

const isProd = process.env.NODE_ENV === "production";

function jsIndex() {
  return rollup
    .rollup({
      input: "./src/js/index.js",
      plugins: [dotenv()],
    })
    .then((bundle) => {
      return bundle.write({
        file: "./dist/index.js",
        format: "iife",
      });
    });
}

function jsBackground() {
  return rollup
    .rollup({
      input: "./src/js/background.js",
      plugins: [dotenv()],
    })
    .then((bundle) => {
      return bundle.write({
        file: "./dist/background.js",
        format: "iife",
      });
    });
}

function jsOptions() {
  return rollup
    .rollup({
      input: "./src/js/options.js",
      plugins: [dotenv()],
    })
    .then((bundle) => {
      return bundle.write({
        file: "./dist/options.js",
        format: "cjs",
      });
    });
}

function jsSentry() {
  return rollup
    .rollup({
      input: "./src/js/sentry.js",
      plugins: [dotenv()],
    })
    .then((bundle) => {
      return bundle.write({
        file: "./dist/sentry.js",
        format: "iife",
      });
    });
}

function jsGitHubAssigneeFetchPatch() {
  return src("./src/js/github-assignee-fetch-patch.js").pipe(dest("dist"));
}

function html() {
  return src("./src/html/*.html").pipe(dest("dist"));
}

function static() {
  return src("./src/assets/**.*").pipe(dest("dist"));
}

function manifest() {
  const pkg = require("./package.json");
  const manifest = require("./src/manifest.json");
  manifest.name = isProd ? (pkg.productName || pkg.name) : `${pkg.productName || pkg.name} Dev`;
  manifest.description = pkg.description;
  manifest.version = pkg.version;
  fs.writeFileSync(
    path.resolve(__dirname, "dist/manifest.json"),
    JSON.stringify(manifest, null, 2)
  );
  return Promise.resolve();
}

if (isProd) {
  exports.build = series(
    jsOptions,
    jsGitHubAssigneeFetchPatch,
    jsIndex,
    jsSentry,
    jsBackground,
    html,
    static,
    manifest
  );
} else {
  watch("./src/**/*", series(jsOptions, jsGitHubAssigneeFetchPatch, jsIndex, jsSentry, jsBackground, html));
  exports.dev = series(
    jsOptions,
    jsGitHubAssigneeFetchPatch,
    jsIndex,
    jsSentry,
    jsBackground,
    html,
    static,
    manifest
  );
  const server = gls.static("dist", 3000);
  server.start();
}
