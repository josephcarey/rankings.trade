# Contributing to rankings.trade

Thanks for your interest in contributing! This is a SvelteKit + Hono +
Cloudflare Workers (D1) app built on Bun and TypeScript (strict).

## Prerequisites

- [Bun](https://bun.sh) (the project's package manager and runtime).

## Getting started

Install dependencies **first** — `bun install` runs the `prepare`
(`svelte-kit sync`) hook that generates the `.svelte-kit` types needed by the
checks:

```sh
bun install
```

Run the app locally:

```sh
bun run dev      # SvelteKit dev server
```

See the [README](README.md) for environment setup (Clerk keys, local D1) and
more detail.

## Quality gate

All pull requests must keep the `ci` check green. CI runs:

```sh
bun run ci
```

which is `bun run check` + `bun run test`:

- **`check`** — `svelte-check`, `tsc --noEmit`, `knip`, `eslint .`, and
  `bun audit --audit-level=high`.
- **`test`** — `vitest run --coverage`.

Run it locally before pushing:

```sh
bun install
bun run ci
```

If `check` fails on a fresh checkout with missing `.svelte-kit` types, run
`bunx svelte-kit sync` and try again.

## Pull requests

1. Branch from `main`.
2. Make your change, keeping `bun run ci` green.
3. Use conventional-ish commit messages (e.g. `fix:`, `feat:`, `docs:`) and add
   the `Co-authored-by` trailer where relevant, matching the existing history.
4. Open a PR against `main` and fill out the
   [pull request template](.github/PULL_REQUEST_TEMPLATE.md). CI is a **required
   check** and code-owner review applies, so PRs need to pass CI to merge.

Keep changes focused and additive where possible. Thanks for contributing!
