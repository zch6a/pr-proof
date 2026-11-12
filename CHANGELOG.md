# Changelog

## 0.1.0 — 2026-11-12

The first version.

- A GitHub Action (`zch6a/pr-proof`) for pull requests (`pull_request_target`, `pull_request`) and issues: checks
  the files, functions and options the text names against the checked-out repository and the pull request's
  changes, the issues and pull requests it references (and that "fixes #N" points to an issue), CVE and GHSA ids,
  and that "adds tests" / "updates the docs" come with test or documentation changes. One comment, edited on later
  runs, and a label (`needs-evidence`); `mode: summary` for a dry run. Skips maintainers and bots by default.
- A command line (`npx -y github:zch6a/pr-proof description.md [--base REF] [--github OWNER/REPO]`).
- No AI, no runtime dependencies; reads the base branch and the diff, runs nothing from the pull request.
