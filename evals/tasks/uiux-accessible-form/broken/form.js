"use strict";

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const FIELDS = [
  { id: "name", type: "text", ac: "name", label: "Full name" },
  { id: "email", type: "email", ac: "email", label: "Email address" },
  { id: "password", type: "password", ac: "new-password", label: "Password", hint: "At least 12 characters." },
];

function renderSignupForm({ values = {}, errors = {} } = {}) {
  const bad = FIELDS.filter((f) => errors[f.id]);
  const summary = bad.length
    ? `<div id="error-summary" role="alert" tabindex="-1"><p>Please fix the following:</p><ul>${bad
        .map((f) => `<li><a href="#${f.id}">${esc(errors[f.id])}</a></li>`)
        .join("")}</ul></div>\n`
    : "";
  const rows = FIELDS.map((f) => {
    const e = errors[f.id];
    const ids = [f.hint && `${f.id}-hint`, e && `${f.id}-error`].filter(Boolean).join(" ");
    const attrs = [
      `id="${f.id}"`, `name="${f.id}"`, `type="${f.type}"`, `autocomplete="${f.ac}"`, "required",
      f.type === "password" ? "" : `value="${values[f.id] || ""}"`,
      e ? 'aria-invalid="true"' : "",
      ids ? `aria-describedby="${ids}"` : "",
    ].filter(Boolean).join(" ");
    return `<div class="field"><label for="${f.id}">${f.label}</label>
<input ${attrs}>
${f.hint ? `<p id="${f.id}-hint">${f.hint}</p>\n` : ""}${e ? `<p id="${f.id}-error" class="error">${esc(e)}</p>\n` : ""}</div>`;
  }).join("\n");
  return `${summary}<form method="post">\n${rows}\n<button type="submit">Create account</button>\n</form>`;
}

module.exports = { renderSignupForm };
