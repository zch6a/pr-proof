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

## Round 1 — 2026-11-12 (0.2.0): precision

The bug class that matters most here is the false alarm: telling a contributor that something true could not be
verified wrongs them, and a maintainer who sees it twice turns the tool off. Two independent sources this round:

- **Real merged pull requests** (`scripts/precision.mjs`, new): shallow clones of seven public projects at pinned
  commits (Flask, Express, HTTPie, bat, HTTPX, Vite, cobra; read only, nothing run) and 128 of their recently merged
  pull requests, checked with their real changed files and real reference lookups. A merged pull request was reviewed
  and accepted, so nearly everything flagged is a false alarm. First run: **33 statements in 24 pull requests**.
  Reading each: three real catches (expressjs/express#7112 names `test/res.sendFile.guards.js` as the location; the
  pull request changes `test/res.sendFile.js`; #7468 says "added unit tests" and changes only `History.md` and
  `package.json`, and links a pull request #6903 that does not exist), three accurate (vite: "fixes" pointing to
  superseded, unmerged pull requests), one dependency function (`recv_method_line()` from h11), and 26 false alarms:
  bare file names (`sample.txt`, the user's file; `express.json`, a function written without parentheses;
  `HISTORY.md` for `History.md`), paths that are not about the repository (example paths like `.kube/config` in a
  pull request about detecting them, another repository's paths, repository slugs like `spf13/cobra`), escaped
  strings turned into paths (`alpha\nbeta\n` became `alpha/n/nbeta/n`), `dist/node` (ignored, generated),
  `actions/setup-go@v6`, test-run reports ("passes (146), including the 10 tests"), and template checkboxes
  ("- [x] I've added a test for each change" on documentation-only pull requests).
- **An independent review** of the code (no network, no changes to the repository) found 22 problems, most of them
  false alarms with exact inputs: "I didn't add tests" read as adding tests (the negation `\bn't\b` can never match
  inside "didn't"), questions and offers ("should I add tests?", "happy to add tests"), "runs tests" / "tests
  matrix", Rust tests inside the source file, frames of a trace from a container (`/app/src/...`) and of
  `site-packages`, `react-dom/client`, `application/json`, `origin/main`, `and/or`, `Node.js`, options defined
  without their dashes (`flag.Bool("dry-run")`, clap's `dry_run`), protobuf getters, UTF-16 and over-1-MB source files
  (the index said "complete" while names were missing), submodules, discussions reported as missing references, hex
  colours and "step #1" taken for issues, and in the Action: a fork's `pull_request` failing the check red (read-only
  token), `label: ""` not turning the label off (`|| fallback`), a personal token adding a new comment every run
  and leaving the label on, line numbers off by two (the title was prepended), rate-limited lookups counted as
  "found", no cap on comment size (544,274 characters for 6,000 code spans; GitHub's limit is 65,536) or on
  lookups, and a `\|` in the contribution breaking out of the table (links and images rendered in the bot's
  comment).

Fixed as rules rather than cases (see the changelog): a path must be about this repository (a folder, and a first
folder the repository or the pull request has), case and Unicode form do not decide, absolute frames are matched
by their end, ignored files and submodules are not checked; statements must be statements (negations, questions,
plans, results and checkboxes are not), tests and docs can be in the code; names match their other spellings;
unknown answers are "not checked", never "found"; the Action never blames the contributor for the workflow's
setup; quoted text is code. Each finding is a test (`test/review1.test.js`, 13 tests), including the three real
catches, which must still be caught.

**After:** 7 statements in 6 of the 128 pull requests, all explained above; the baseline is in
`scripts/corpus.json` and the script fails on any new flag. An error of my own along the way: an exclusion added for
"docs for CI" also rejected "Adds docs for the new option"; the test of real statements caught it.

Tests: 29 (was 16).

## Round 2 — 2026-11-12 (0.3.0)

- **The real thing, on GitHub.** Until now the Action had run only against a local stand-in for the API. This
  repository's own workflow (`.github/workflows/pr-proof.yml`, `uses: ./`, now with `check-maintainers: true`, since
  its pull requests are the owner's) checked a test pull request whose description named an issue, a file, a
  function and an option that do not exist and said it adds tests: under `pull_request_target`, github-actions
  commented with all five, each right, and added `needs-evidence`. The description was then edited to name things
  that exist: the same comment was edited to "everything … was found (3 checked)" and the label came off. A test
  issue got its comment too, with a real lookup on cve.org for an id that does not exist. Both closed, the branch
  deleted. (A SonarCloud bot installed on the account commented on the pull request as well; nothing to do with this.)
- **A slip of mine:** I pushed a commit while one test was failing (the command went on after `npm test` failed):
  the new workflow test read a `uses: ./` inside a YAML comment. Fixed in the next commit, and the commit step now
  runs only when the tests pass.
- **Releases** (`.github/workflows/release.yml`): a version tag tests with a read-only token, then a job that runs
  nothing of the project makes the GitHub release from the CHANGELOG and moves the major tag (`v0`), which is how
  Action users pin. `test/workflows.test.js` keeps the write token out of the test job and every action pinned.
- **Docs:** CONTRIBUTING (a false alarm is the worst bug; run the precision check), SECURITY (what the token is
  used for, bounds, hostile text, recommended permissions), linked from the README; the README points to the two
  real runs.
- **Code:** `tsc` with `noUnusedLocals` and `noUnusedParameters` found nothing unused; both are now on.
- **Presentation:** social preview (`docs/social-preview.png`, from `scripts/social-card.html`: the comment from the
  real run), launch kit (`launch/pr-proof.md`, outside the repository).

Tests: 33 (was 29).
