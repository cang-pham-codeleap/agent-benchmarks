# Statechart interpreter

Implement `machine.js` (see the task description for the full contract).
Two example configs live in `examples/`; this one is an order workflow:

```js
const { createMachine, assign } = require("./machine");
const order = require("./examples/order-workflow");

const m = createMachine(order);
m.send("SUBMIT");                 // { value: "checkout.payment.method", ... }
m.send({ type: "PAY", card: "x" });
m.send("PAUSE");                  // jumps to the history-aware `hold` state
m.send("RESUME");                 // back to where checkout was
m.snapshot();                     // plain JSON, restorable with m.restore()
```
