"use strict";

function renderSignupForm({ values = {}, errors = {} } = {}) {
  const v = (k) => values[k] || "";
  const err = (k) => (errors[k] ? `<span class="error">${errors[k]}</span>` : "");
  return `<form method="post">
  <input id="name" placeholder="Full name" value="${v("name")}">
  ${err("name")}
  <input id="email" placeholder="Email address" value="${v("email")}">
  ${err("email")}
  <input id="password" type="password" placeholder="Password" value="${v("password")}">
  <small>At least 12 characters.</small>
  ${err("password")}
  <div class="btn" onclick="this.closest('form').submit()">Create account</div>
</form>`;
}

module.exports = { renderSignupForm };
