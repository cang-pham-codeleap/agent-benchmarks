"use strict";
const { assign } = require("../machine");

// Order workflow: cart -> checkout (shipping, payment, review) -> fulfilled.
module.exports = {
  context: { items: 0, paid: false, attempts: 0, log: [] },
  initial: "cart",
  on: { CANCEL: { target: "cancelled", actions: assign({ log: (c) => [...c.log, "cancel"] }) } },
  states: {
    cart: {
      on: {
        ADD: { actions: assign({ items: (c) => c.items + 1 }) },
        SUBMIT: { target: "checkout", cond: (c) => c.items > 0 },
      },
    },
    checkout: {
      initial: "shipping",
      entry: assign({ attempts: 0 }),
      on: {
        PAUSE: "hold",
        "done.state.checkout": "fulfilled",
        BACK: { target: "cart" },
      },
      states: {
        shipping: { on: { NEXT: "payment" } },
        payment: {
          initial: "method",
          on: { "done.state.checkout.payment": "review" },
          states: {
            method: { on: { PAY: "authorizing" } },
            authorizing: {
              entry: assign({ attempts: (c) => c.attempts + 1 }),
              on: {
                OK: { target: "ok", actions: assign({ paid: true }) },
                FAIL: [
                  { target: "method", cond: (c) => c.attempts < 3 },
                  { target: "#cancelled" },
                ],
              },
            },
            ok: { type: "final" },
          },
        },
        review: { on: { CONFIRM: "done" } },
        done: { type: "final" },
        past: { type: "history", target: "shipping" },
      },
    },
    hold: { on: { RESUME: "checkout.past" } },
    fulfilled: { type: "final" },
    cancelled: { type: "final" },
  },
};
