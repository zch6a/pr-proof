# pr-proof — polish log

## Development — 2026-11-12 (0.1.0)

Why it exists: maintainers report that a growing share of pull requests and bug reports are fluent and wrong, naming
functions the project does not have and "fixing" issues that are pull requests. Checked before starting (the rule for
#14): the "AI slop PR" space is crowded (anti-slop with 854 stars and 31+ rules, AI Slop Gate, PR Slop Gate, Slopper,
PR-Sentry, GitHub's own new settings to limit outside pull requests), but every rule there judges the form: branch
names, size, title format, emoji, templates, account age, merge history; anti-slop's "code references" rule only
counts them. None checks whether the statements are true against the repository. That is what pr-proof does, and it
is meant to run next to those tools.

Design decisions:
- **No AI, no judgement.** Every result is checkable by hand (a file listing, a word in the source, an API answer);
  the comment never says how a contribution was written, and says how to answer ("a link or a line of explanation").
- **Runs nothing from the pull request.** It reads the checked-out base and the diff from the API, so it is safe under
  `pull_request_target`, which fork pull requests need for a token that can comment.
- **Absence is reported only when it proves something**: names are not checked against a partial index (huge
  repositories) or a diff with missing patches; a reference in a repository the token cannot see is "unknown"; an
  API or network error is never "missing".
- **What counts as a claim** (`src/claims.js`): paths, `name()` and `--options` in inline code; paths in stack traces
  in code blocks (other code in blocks is someone else's code); `#N`, `owner/repo#N`, issue links and closing keywords;
  CVE and GHSA ids; "adds tests" / "updates the docs" unless negated. Not: HTML comments (template instructions),
  quotes, unticked checkboxes, URLs, placeholders, system paths, globs.
- **One comment**, found again by a marker and edited; the label comes off when everything checks out; quiet when
  there is nothing to say and never was. Maintainers and bots skipped by default. Text from the contribution in the
  comment cannot mention anyone, open HTML or break the table.

Found while building it:
- A folder written as one (`src/widget/`) was rejected: the name after the last slash was empty.
- The Action never passed the CVE API address to its client, so the issue test made real requests to cve.org (it took
  4 s, which gave it away). Tests must not touch the network: an override for tests and mirrors, and the issue test
  now runs against the stand-in (0.7 s).
- The README said unticked checkboxes are skipped; the code skipped them only for the tests/docs statements. The code
  now skips the whole line (a template item says nothing yet), with a test.
- The editing tool turned `\\u200B` in the comment code into a real zero-width space again; the escape script from
  provenance-check, generalised to take a project folder, fixed it.

Tests: 16 (claims, the repository index, verification, the comment, the Action end to end against a local stand-in for
the GitHub API with an event file, a workspace and `INPUT_*` variables, and the command line with `--base`), on
throwaway repositories in the temp folder.
