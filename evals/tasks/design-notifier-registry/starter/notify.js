"use strict";

function send(message) {
  if (message === null || typeof message !== "object") {
    throw new TypeError("message must be an object");
  }
  switch (message.channel) {
    case "email": {
      if (typeof message.to !== "string" || !/^[^@\s]+@[^@\s]+$/.test(message.to)) {
        throw new TypeError("invalid email address");
      }
      if (typeof message.subject !== "string" || message.subject === "") {
        throw new TypeError("email subject required");
      }
      if (typeof message.body !== "string" || message.body.trim() === "") {
        throw new TypeError("body required");
      }
      return {
        channel: "email",
        result: `To: ${message.to}\nSubject: ${message.subject}\n\n${message.body}`,
      };
    }
    case "sms": {
      if (typeof message.to !== "string" || !/^\+\d{8,15}$/.test(message.to)) {
        throw new TypeError("invalid phone number");
      }
      if (typeof message.body !== "string" || message.body === "") {
        throw new TypeError("body required");
      }
      if (message.body.length > 160) {
        throw new TypeError("sms body too long");
      }
      return { channel: "sms", result: message.body };
    }
    case "slack": {
      if (typeof message.to !== "string" || !/^#[a-z0-9_-]+$/.test(message.to)) {
        throw new TypeError("invalid slack channel");
      }
      if (typeof message.body !== "string" || message.body.trim() === "") {
        throw new TypeError("body required");
      }
      return { channel: "slack", result: `[${message.to}] ${message.body}` };
    }
    default:
      throw new Error(`unknown channel: ${message.channel}`);
  }
}

module.exports = { send };
