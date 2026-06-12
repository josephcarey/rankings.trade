# Card #13 — profile settings form UI

## Summary
The authed `/settings` page now renders a superforms-bound form for editing
profile visibility and the dashboard link, wired to the card #12 load/action.

## What changed
- `src/routes/settings/+page.svelte` (new) — `superForm(data.form)` client form:
  - visibility radio group (public/private) bound to `$form.visibility`.
  - `dashboard_url` URL text input bound to `$form.dashboard_url` with a Clear
    button (empties the field → action persists null) and inline field error.
  - inline validation errors (`$errors`) and a success confirmation (`$message`).
  - styled with the Epic A base tokens (open-props), accessible labels +
    `aria-invalid`/`aria-describedby`.

## Testing approach
UI-only card. Per repo convention `.svelte` files are excluded from vitest
coverage and there is no component-test harness; correctness of the wired
behavior (validation, persistence, clear, success/error) is covered by card
#12's server + schema tests. The `.svelte` is gated by `svelte-check`
(types + a11y) in CI.

## Evidence
`bun run ci` green (exit 0): svelte-check 0 errors (1 benign warning — the
standard `superForm(data.form)` initial-value idiom, non-failing), 19 test
files, 124 tests, global coverage ≥80%.

## AC mapping
- AC1 authed page renders a superforms-bound form → +page.svelte using superForm + #12 load/action.
- AC2 visibility toggle + dashboard_url field reflect current values → bound to $form seeded by load.
- AC3 inline errors on failure, confirmation on success → $errors + $message.
- AC4 dashboard link clearable from UI → Clear button + empty→null in action.
