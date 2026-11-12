# Changelog

## 0.4.0 — 2026-11-12

Polishing round 3: a fresh sample, issues, more languages. The precision run now covers eleven projects and closed
issues as well as merged pull requests (`scripts/precision.mjs` picks both); on it, before this round, 14 statements
were flagged in 230 merged pull requests and 9 in 156 issues. Now 9 in 8 pull requests (three real, five accurate,
one dependency function) and none in 79 issues from the last year.

- **Issues: names are not checked by default.** In real issues, file, function and option names were the reporter's
  own project (`src/lib/bread.ts` in a Vite user's app, `tests/bootstrap.php` in a Laravel app), proposals ("it would
  be nice to have `--markdown-tables`") or names that were true when the issue was opened. References and advisories
  are still checked; `issue-names: true` checks names too.
- **A path's first folder must be a top-level folder** of the repository or the pull request: in a monorepo whose
  `src` folders are inside packages, `src/index.js` in a documentation pull request is the reader's own site.
- **A pull request that removes a function names it on its removed lines**: those count (spf13/cobra#2063 says it
  removes `GetFlagCompletion()`).
- **"Test" as an adjective is not a claim of adding tests** ("the test type-check command"); "a test", "test cases"
  and "tests" are.
- The precision run reports index time and memory per repository, and checks the title on its own as the Action does.

## 0.3.0 — 2026-11-12

Polishing round 2.

- **Tried end to end on GitHub**, on this repository: a pull request with five statements that do not check out got
  one comment (all five right) and the `needs-evidence` label; after its description was fixed the same comment was
  edited to say everything checked out and the label came off (#1); an issue got its comment, with a real lookup on
  cve.org (#2). Until now the Action had only run against a local stand-in for the API.
- **Releases:** each version tag makes a GitHub release with the version's CHANGELOG section and moves the major tag,
  so workflows can use `zch6a/pr-proof@v0`; tested with a read-only token, and the job that can write runs nothing of
  the project.
- `CONTRIBUTING.md` (a false alarm is the worst bug; the precision check before a pull request), `SECURITY.md` (what
  the token is used for, hostile text, the recommended permissions).
- The type check now also fails on unused code.

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
