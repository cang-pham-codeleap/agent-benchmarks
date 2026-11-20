"use strict";
const fs = require("node:fs");
const path = require("node:path");

function inside(dir, file) {
  const rel = path.relative(dir, file);
  return rel === "" || (rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel));
}

function resolveStatic(root, urlPath) {
  try {
    if (typeof root !== "string" || typeof urlPath !== "string" || urlPath[0] !== "/") return null;
    const decoded = decodeURIComponent(urlPath.split(/[?#]/, 1)[0]);
    if (decoded.includes("\0") || decoded.includes("\\")) return null;
    root = path.resolve(root);
    let file = path.resolve(root, "." + decoded);
    if (!inside(root, file)) return null;
    if (fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!fs.statSync(file).isFile()) return null;
    if (!inside(fs.realpathSync(root), fs.realpathSync(file))) return null;
    return file;
  } catch {
    return null;
  }
}

module.exports = { resolveStatic };
