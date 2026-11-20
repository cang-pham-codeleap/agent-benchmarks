"use strict";

const text = (v) => typeof v === "string" && v.trim() !== "";
const need = (ok, msg) => {
  if (!ok) throw new TypeError(msg);
};

const BUILTINS = {
  email: {
    validate: (m) => {
      need(typeof m.to === "string" && /^[^@\s]+@[^@\s]+$/.test(m.to), "invalid email address");
      need(typeof m.subject === "string" && m.subject !== "", "email subject required");
      need(text(m.body), "body required");
    },
    deliver: (m) => `To: ${m.to}\nSubject: ${m.subject}\n\n${m.body}`,
  },
  sms: {
    validate: (m) => {
      need(typeof m.to === "string" && /^\+\d{8,15}$/.test(m.to), "invalid phone number");
      need(typeof m.body === "string" && m.body !== "", "body required");
      need(m.body.length <= 160, "sms body too long");
    },
    deliver: (m) => m.body,
  },
  slack: {
    validate: (m) => {
      need(typeof m.to === "string" && /^#[a-z0-9_-]+$/.test(m.to), "invalid slack channel");
      need(text(m.body), "body required");
    },
    deliver: (m) => `[${m.to}] ${m.body}`,
  },
};

function createNotifier() {
  const registry = new Map();
  const notifier = {
    register(name, channel) {
      need(typeof name === "string" && name !== "", "channel name must be a non-empty string");
      need(
        channel && typeof channel.validate === "function" && typeof channel.deliver === "function",
        "channel needs validate() and deliver()",
      );
      if (registry.has(name)) throw new Error(`channel already registered: ${name}`);
      registry.set(name, channel);
    },
    send(message) {
      need(message !== null && typeof message === "object", "message must be an object");
      const channel = registry.get(message.channel);
      if (!channel) throw new Error(`unknown channel: ${String(message.channel)}`);
      channel.validate(message);
      return { channel: message.channel, result: channel.deliver(message) };
    },
    channels: () => [...registry.keys()],
  };
  for (const [name, channel] of Object.entries(BUILTINS)) notifier.register(name, channel);
  return notifier;
}

module.exports = { createNotifier, send: createNotifier().send };
