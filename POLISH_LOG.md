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

## Round 3 — 2026-11-12 (0.4.0): a fresh sample, issues, more languages

- **The question:** round 1's fixes were made on the pull requests they were measured on. Do they hold on pull
  requests they never saw, on issues (which round 1 did not measure at all), and in other languages? The precision
  script now picks closed issues too (completed, by people), and four projects were added: OkHttp (Kotlin and Java),
  Laravel (PHP), mdBook (Rust) and Docusaurus (a TypeScript monorepo).
- **First run on the fresh sample:** 230 merged pull requests, 14 statements in 13; 156 closed issues, 9 in 8.
  - Pull requests: the three known catches and the known dependency function; five "fixes" pointing to a closed,
    superseded pull request (accurate); and four new false alarms: Docusaurus `static/assets/` and `src/index.js` (a
    user's site, in documentation pull requests; the repository's `src` folders are all inside `packages/`), "Added the
    test type-check command" (an adjective), and spf13/cobra#2063's `GetFlagCompletion()`, which the pull request says
    it removes (the name was only on its removed lines, which were not read).
  - Issues: nearly all false alarms, of kinds pull requests do not have: the reporter's own project (`src/lib/bread.ts`
    in a Vite user's app, `tests/bootstrap.php`, a Docusaurus site's `i18n/de/...`), a proposal (bat: "add
    `--markdown-tables`"), and names true when the issue was opened (httpie's issue #1, from 2012, names files long
    gone). A repository's files are simply not what most issues are about.
- **Fixed:** names in issues off by default (`issue-names: true` to check; the comment says so), a top-level first
  folder for paths, removed lines read, "test" only as a noun. Each is a test (`test/round3.test.js`), next to the real
  cases that must still be caught. The precision script picks issues from the last year only (an issue from 2012
  against today's code says nothing about the tool).
- **After:** 230 pull requests, 9 statements in 8 (three real, five accurate, one dependency function); 79 issues,
  none. Indexing: 0.2 to 5.6 seconds and at most 230 MB per repository (Docusaurus, 4,310 files), fine for an Action
  that runs on every edit.
- Also: the script now checks the title on its own, as the Action does (it still prepended it to the body).

Tests: 37 (was 33).

## Round 4 — 2026-11-12 (0.5.0): a second review, an ignore list

- **`ignore`**, for the false alarm that is left by design: a function only a dependency has (`recv_method_line()`
  from h11 on encode/httpx). One line in the workflow instead of the same answer on every pull request.
- **A second independent review** (someone who had not written it; no network; the repository untouched) tried pull
  request and issue texts in the styles of many ecosystems and found, confirmed by running each: false alarms in the
  tests/docs statements (existing tests, removals, template answers, test ids and plans, CI speed, copied release
  notes, `<blockquote>`, status marks), tests and docs it did not recognise (Rust attributes, C# `[Fact]`, `test-d.ts`,
  Perl `t/`, edits inside docstrings, Go doc comments, towncrier fragments), link text taken for this repository's
  issues, other trackers' numbers, PHP and gdb frames written as prose, names in links to other projects, standard
  libraries of Java/C#/PHP/Swift, git/npm/pip options, the reporter's own stack frames, indented fences, an unclosed
  comment; **real problems it missed**: every path ending in `.rs` or `.sh` (a rule meant for bare library names
  like `docs.rs` also dropped `src/main.rs`, so Rust repositories had no path checks at all), extensions it did not
  know, closing keywords through a link or in bold; in the Action, red checks when GitHub fails, a second comment
  after a failed listing or two quick runs, a deleted comment failing the job, a locked conversation blocking the
  label, the 3,000-file cap of the API read as complete; a **quadratic** regular expression (`KEBAB`: 28 s on a
  256 KB line, in patches a contributor controls); quotes of statements with their code blanked out; `--base` broken
  by `diff.noprefix`; and documentation gaps (no `ignore` row, 80 claims instead of 40, missing API calls). All fixed,
  each in `test/review2.test.js` (12 tests).
- My own: the new sentence splitter cut `utils.compileETag` into two sentences, and my doc-comment pattern took any
  `# comment` for documentation; both caught by the existing tests.
- **A correction of rounds 1 and 3.** Re-running the precision check after these fixes, two of the "real catches"
  on expressjs/express#7468 disappeared. Reading the pull request: it is a release, and its body is the copied
  release notes of dozens of other pull requests; "test: added unit tests for utils.compileETag" is the note of
  #6534, by another author. That was never this pull request's claim: the round 1 count of three real catches was
  wrong, and the README said so twice. Copied notes are now left alone (and so is "made their first contribution
  in", where the third item came from; that link really is dead). README, changelog and this log corrected.
- **After:** 230 merged pull requests: 7 statements in 7 (one real catch: #7112 names a file the pull request does
  not touch; five "fixes" pointing to a closed pull request; one dependency function); 79 closed issues: none.

Tests: 52 (was 37).
