"use strict";
const { assign } = require("../machine");

// Internal vs external transitions and shallow history.
module.exports = {
  context: { position: 0, plays: 0 },
  initial: "stopped",
  states: {
    stopped: { on: { PLAY: "active" } },
    active: {
      initial: "playing",
      entry: assign({ plays: (c) => c.plays + 1 }),
      on: {
        STOP: "stopped",
        RESTART: { target: "active" }, // external self-transition: re-enters
        REWIND: { target: ".playing", internal: true, actions: assign({ position: 0 }) },
      },
      states: {
        playing: { on: { PAUSE: "paused", TICK: { actions: assign({ position: (c, e) => c.position + (e.by || 1) }) } } },
        paused: { on: { PLAY: "playing" } },
      },
    },
  },
};
