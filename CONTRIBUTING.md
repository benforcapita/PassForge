# Contribute

## Introduction

Thank you for considering contributing to PassForge!

We welcome any type of contribution, not only code. You can help by...

- **QA**: filing bug reports; the more details you can give the better (e.g. screenshots with the console open)
- **Code**: taking a look at the [open issues](https://github.com/benforcapita/PassForge/issues). Even if you can't write code, commenting on them and showing that you care about a given issue matters. It helps us triage them.

## Your first contribution

Working on your first Pull Request? You can learn how using this *free* series, [*How to Contribute to an Open Source Project on GitHub*](https://egghead.io/courses/how-to-contribute-to-an-open-source-project-on-github).

## Development

### Tools

Before diving in to the code, you'll need these tools installed in your environment:

* [NodeJS](https://nodejs.org/) 22.x
* [Yarn](https://yarnpkg.com/) 4 (via `corepack`)
* [Rust](https://www.rust-lang.org/) (stable) for `crates/` and `desktop/src-tauri/`

If you are working on the CLI, you will need:

* [Python 3](https://www.python.org/)

### Folder architecture

Here are some folders worth noticing:

* `desktop` — Tauri v2 desktop app: React 19 frontend in `desktop/src`, Rust backend (`passforge-desktop` crate) in `desktop/src-tauri`.
* `crates/lesspass-core` — Rust implementation of the deterministic password-generation algorithm.
* `packages`
  * `lesspass` — TypeScript implementation of the algorithm (used by the extension).
  * `passforge-extension` — Chromium MV3 extension. Stateless generator; prefills profile parameters via the `passforge-host` native-messaging binary when installed.
* `cli` — offline-only Python CLI.
* `docs` — design system, security checklist, macOS verification checklist.

### Commands

Install dependencies with `yarn install`.

Run `yarn build` / `yarn test` at the root (or per workspace), `cargo test` for Rust, and `cd cli && PYTHONPATH=. python3 -m unittest discover -s tests -t .` for the CLI.

## Submitting code

Any code change should be submitted as a pull request. The description should explain what the code does and give steps to execute it. The pull request should also contain tests for any new functionality.

## Code review process

The bigger the pull request, the longer it will take to review and merge. Try to break down large pull requests into smaller chunks that are easier to review and merge.

It is also always helpful to have some context for your pull request. What was the purpose? Why does it matter to you? How will it benefit PassForge?

## Questions

If you have any questions, create an [issue](https://github.com/benforcapita/PassForge/issues/new/). Protip: do a quick search first to see if someone else has asked the same question before!
