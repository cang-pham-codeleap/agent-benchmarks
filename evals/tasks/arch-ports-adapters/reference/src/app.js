"use strict";
const { createOrderService } = require("./domain/orders");
const { createFileRepository } = require("./infra/file-store");

function createApp(dir) {
  return createOrderService({
    repository: createFileRepository(dir),
    clock: { now: () => Date.now() },
  });
}

module.exports = { createApp };
