# Changelog

## 0.2.0 — 2026-11-12

Polishing round 1: precision. An independent review found 22 problems, most of them false alarms (telling a
contributor that something true could not be verified); running on 128 recently merged pull requests of seven public
projects found 33 flagged statements in 24 of them, nearly all false alarms. Now 7 in 6, three of them real catches.

- **What is a claim about this repository:** a path needs a folder and a first folder the repository (or the pull
  request) has; bare file names, slashed words (`and/or`, `react-dom/client`), library names (`Node.js`), escaped
  strings (`alpha\nbeta`), ignored and generated files and submodule paths are left alone. Paths match ignoring case
  and Unicode form (`HISTORY.md` for `History.md`). Stack-trace frames from another machine (`/app/src/x.py`) are
  matched by their end; frames of dependencies and the runtime are skipped.
- **Statements:** negations ("I didn't add tests": `n't` never matched), questions, offers, plans, test-run reports
  ("456 passed") and template checkboxes are no longer statements; tests written next to the code (`#[test]`,
  `def test_`) and doc comments count; more test and doc file names (`testdata/`, `*_unittest.cc`, `FooIT.java`,
  `*.cy.ts`, `man/*.Rd`).
- **Names:** options defined without their dashes (`flag.Bool("dry-run")`, clap's `dry_run`) and generated getters
  (`getUserId()` for `user_id`) are found; calls on standard libraries are not checked; UTF-16 files and source files
  up to 16 MB are indexed, and the index says it is incomplete when a source file is missing or too large.
- **References:** discussions are found (GraphQL); colours, ordinals ("step #1"), `#0`, indented code and `<pre>`
  are not references; a lookup that did not answer (a rate limit) is listed as not checked instead of counting as
  found; at most 30 lookups per check. GHSA ids are also looked up among the repository's own advisories.
- **The Action:** `label: ""` turns the label off; a personal access token finds its own comment again and the label
  always comes off when everything checks out; a `pull_request` event from a fork (read-only token) writes the
  summary only, and a token that cannot write is a warning, not a failed check; the title is checked on its own, so
  line numbers are the body's.
- **The comment:** text from the contribution is shown in code spans (no links, images or mentions), a backslash can
  no longer undo the escaped pipe, and long results are cut under GitHub's limit.
- `scripts/precision.mjs` and `scripts/corpus.json`: the precision run on public pull requests, with its baseline.

## 0.1.0 — 2026-11-12

The first version.

- A GitHub Action (`zch6a/pr-proof`) for pull requests (`pull_request_target`, `pull_request`) and issues: checks
  the files, functions and options the text names against the checked-out repository and the pull request's
  changes, the issues and pull requests it references (and that "fixes #N" points to an issue), CVE and GHSA ids,
  and that "adds tests" / "updates the docs" come with test or documentation changes. One comment, edited on later
  runs, and a label (`needs-evidence`); `mode: summary` for a dry run. Skips maintainers and bots by default.
- A command line (`npx -y github:zch6a/pr-proof description.md [--base REF] [--github OWNER/REPO]`).
- No AI, no runtime dependencies; reads the base branch and the diff, runs nothing from the pull request.

