"use strict";
const fs = require("node:fs");
const path = require("node:path");

function createFileRepository(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = (id) => path.join(dir, id + ".json");
  return {
    save(order) {
      fs.writeFileSync(file(order.id), JSON.stringify(order));
    },
    get(id) {
      try {
        return JSON.parse(fs.readFileSync(file(id), "utf8"));
      } catch (e) {
        if (e.code === "ENOENT") return null;
        throw e;
      }
    },
    list() {
      return fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")))
        .sort((a, b) => Number(a.id.slice(4)) - Number(b.id.slice(4)));
    },
  };
}

module.exports = { createFileRepository };
