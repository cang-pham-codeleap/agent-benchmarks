# Fix the accessibility of the signup form

`form.js` exports `renderSignupForm({ values, errors })`, which returns an HTML string for a signup form. It has real accessibility defects. Fix it so the output meets the requirements below. Keep the export name and signature; the function must return a string. Do not add dependencies.

Inputs:
- `values`: optional object with string values for `name`, `email`, `password` (missing keys mean empty).
- `errors`: optional object mapping a field id (`name`, `email`, `password`) to an error message string. Empty or missing messages mean no error; unknown keys are ignored.

## Requirements

Fields, in this order, each with `id` equal to the field name:

| id | type | autocomplete | label text |
|----|------|--------------|------------|
| `name` | `text` | `name` | Full name |
| `email` | `email` | `email` | Email address |
| `password` | `password` | `new-password` | Password |

1. Every input has a visible `<label>` whose `for` equals the input's `id` and whose text is the label text above. Placeholders must not be the only label.
2. All three inputs have the `required` attribute, a `name` attribute equal to the id, and the `type` and `autocomplete` shown above.
3. The password field always has a hint element with the text `At least 12 characters.`, and the password input's `aria-describedby` always references it (by id).
4. A field that has an error gets `aria-invalid="true"` and an `aria-describedby` that lists the id of an element containing exactly that error text (after HTML decoding). For the password field, `aria-describedby` lists both the hint id and the error element id (space separated). Fields without an error must not have `aria-invalid` (or have it `"false"`), and name/email without an error have no `aria-describedby`.
5. The submit control is a real `<button type="submit">` with the text `Create account`; no `div`/`span` acting as a button.
6. When at least one field has an error, the output contains an error summary: one element with `role="alert"` and `tabindex="-1"` that contains one `<a href="#<id>">` per invalid field (in field order), each link's text including that field's error message. With no errors there is no `role="alert"` element.
7. The password value is never written back into the HTML. Other values are written to the `value` attribute.
8. All user-supplied data (values and error messages) is HTML-escaped so it cannot inject markup or break out of attributes.
9. All inputs live inside a single `<form method="post">`.
10. All `id` values in the output are unique.
