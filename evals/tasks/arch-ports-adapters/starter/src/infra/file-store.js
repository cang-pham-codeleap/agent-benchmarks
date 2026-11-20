"use strict";
const fs = require("node:fs");
const path = require("node:path");

function save(dir, order) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, order.id + ".json"), JSON.stringify(order));
}

function load(dir, id) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, id + ".json"), "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}

function all(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")))
    .sort((a, b) => Number(a.id.slice(4)) - Number(b.id.slice(4)));
}

module.exports = { save, load, all };
