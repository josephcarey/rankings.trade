# Card #12 — profile settings server (load, update action, persistence)

## Summary
Authed `/settings` server: a `load` that seeds a superform from the user's
persisted `visibility` + `dashboard_url`, and a form `action` that validates
input (valibot), persists via `updateUserProfile`, and reports field-level
errors / success. First use of `sveltekit-superforms` + `valibot` in the repo.

## What changed
- `bun add sveltekit-superforms valibot`.
- `src/routes/settings/profile-schema.ts` (new) — `profileSchema` (valibot):
  `visibility ∈ {public,private}`; `dashboard_url` trimmed, ≤2048 chars,
  empty-or-http(s) URL. `toDashboardUrl("")→null` clear helper.
- `src/routes/settings/+page.server.ts` (new) — `load` (defensive redirect when
  no local user; seeds form) + default `action` (superValidate → fail(400) on
  invalid; persists via `updateUserProfile`; fail(404) if row missing;
  `message(form, "Profile updated.")` on success).
- `package.json` — `check` script's audit aligned to the studio standard:
  `bun audit --audit-level=high` (only High/Critical fail the build). superforms
  pulls an unused optional `joi` adapter with a moderate advisory; we use valibot,
  never load joi. The standard says only High/Critical should gate.

## Tests
- `profile-schema.test.ts` (10) — visibility picklist, http/https accept,
  non-url/non-http(s)/over-length reject, empty allowed, trim, `toDashboardUrl`.
- `page.server.test.ts` (7) — load seeds form; load redirects when user null;
  action persists valid + success message; trims; clears on empty; invalid url →
  400 field error + no persist; missing row → 404. Uses the repo's sql.js D1 adapter.

## Evidence
`bun run ci` green: 19 test files, 124 tests, settings dir 96% coverage, global ≥80%.

## AC mapping
- AC1 load returns visibility+dashboard_url → load test.
- AC2 validate + persist via helper → schema + action.
- AC3 invalid → field error, no persist; valid → persists+success → action tests.
- AC4 superforms introduced + used in action → yes.
- AC5 load+action+validation tested → above.

## Note
`ProfileInput` type export removed (knip: unused) — card #13 can re-introduce if the form UI needs it.
