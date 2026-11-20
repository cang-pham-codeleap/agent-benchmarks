"use strict";
const fs = require("node:fs");
const path = require("node:path");

// Maps a request URL path to a file under root.
function resolveStatic(root, urlPath) {
  const file = path.join(root, urlPath);
  return fs.existsSync(file) ? file : null;
}

module.exports = { resolveStatic };
