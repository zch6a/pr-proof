<div align="center">

# pr-proof

**Checks what a pull request or issue says against your repository.** The files, functions and options it names
exist; the issues it references are real; "fixes #41" points to an issue; "adds tests" comes with tests; the CVE
it cites exists. What does not check out goes into one comment, with a label. No AI, no guessing who or what wrote
it: facts, and a request for evidence.

<a href="https://github.com/zch6a/pr-proof/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/zch6a/pr-proof/actions/workflows/ci.yml/badge.svg"></a>
<img alt="No dependencies" src="https://img.shields.io/badge/dependencies-0-2ea44f">
<img alt="No AI" src="https://img.shields.io/badge/AI-none-blue">
<a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-blue"></a>

**English** · [简体中文](README.zh-CN.md)

</div>

---

Maintainers now get pull requests and bug reports that read well and describe code the project does not have:
a function that was never written, a file in the wrong place, "fixes #41" where #41 is someone else's pull request,
tests that are mentioned and not there. Checking each claim by hand is the work that drains maintainers. pr-proof does
the checking, and leaves this (real output, on the test project):

> **pr-proof** could not verify 5 statements in this pull request against the repository:
>
> | | Says | Checked |
> |---|---|---|
> | Fixes (line 1) | `#41` | It says it fixes #41, which is a pull request, not an issue: closing keywords only close issues. |
> | File (line 3) | `src/widget/tokens.py` | No file or folder `src/widget/tokens.py` in this repository or in this pull request's changes (at ffadaa6). |
> | Function (line 3) | `refresh_token_cache()` | The name `refresh_token_cache` appears nowhere in this repository or in this pull request's changes (at ffadaa6). |
> | Option (line 4) | `--force-sync` | The option `--force-sync` appears nowhere in this repository or in this pull request's changes (at ffadaa6). |
> | Tests (line 4) | `This also adds regression tests.` | It says it adds tests, but none of the changed files is a test file, and no added line is a test. |
>
> If these are right (a function from a dependency, an issue in another tracker), a link or a line of explanation is all that is needed. This is a check of facts, not a judgement of the contribution or of how it was written.

When the author fixes the description or the code, the next run edits the same comment to say everything checked out
and takes the label off.

## What it checks

| | |
|---|---|
| **Files** | paths in inline code (`src/auth.py`, `lib/x.js:42`, `docs/`) and frames of stack traces in code blocks (Python, JavaScript, Go): in the repository (ignoring case), or added, renamed or removed by the pull request. Only paths that are about this repository: with a folder, and a first folder the repository has |
| **Functions** | `name()`, `obj.name()`, `Mod::name()` in inline code: the name appears somewhere in the repository or on the pull request's added lines, in any of its spellings (`user_id` for `getUserId()`) |
| **Options** | `--long-option` in inline code: appears in the repository or the pull request, with or without its dashes (`flag.Bool("dry-run")`, clap's `dry_run`) |
| **References** | `#12`, `owner/repo#12` and issue links exist (as an issue, pull request or discussion); "fixes / closes / resolves #12" in a pull request points to an issue, not a pull request |
| **Advisories** | CVE ids exist in the CVE list (cve.org); GHSA ids in the GitHub Advisory Database or the repository's own advisories |
| **Statements** | a pull request that says it adds tests changes a test file or adds test code (`#[test]`, `def test_`); one that says it updates the docs changes documentation or adds doc comments |

Skipped on purpose, because a contributor told that something true "could not be verified" is wronged:
- HTML comments (pull request templates keep their instructions there), quoted replies, and template checkboxes
  (ticked or not: "- [x] I've added tests" is the template's question, not the author's statement);
- negations, questions, offers and plans ("I didn't add tests", "should I add tests?", "I'll add tests later"),
  and reports of a test run ("all 456 tests pass");
- names that are not about this repository: bare file names (`sample.txt` is usually the reader's own file),
  slashed words (`and/or`, `react-dom/client`, `origin/main`), library names (`Node.js`), URLs, placeholders,
  absolute and home paths, globs, ignored and generated files, and files in submodules;
- frames of dependencies and the runtime in stack traces (`site-packages`, `node_modules`, `/usr/lib`), and code in
  code blocks other than stack traces (a pasted snippet calls other people's code);
- calls on standard libraries (`JSON.parse()`, `std::fs::read()`), options every framework adds (`--help`),
  colours (`#333` in a line about colours), ordinals ("step #1") and `#0`.

**Measured** on 128 recently merged pull requests of seven projects (Flask, Express, HTTPie, bat, HTTPX, Vite,
cobra), where nearly everything flagged would be a false alarm: 7 statements in 6 pull requests. Three are real (a
description naming a file the pull request does not touch, "added unit tests" on a pull request that changes no test,
a link to a pull request that does not exist), three say "fixes" for a pull request that was superseded, one is a
function from a dependency. `scripts/precision.mjs` re-runs it against that baseline.

## What it never does

- **No AI.** Every result is something you can check yourself: a file listing, a word in the source, an API answer.
- **No accusations.** It does not say a contribution was written by AI, or is spam, or is bad. It says which
  statements it could not verify and how to answer ("a link or a line of explanation").
- **Runs nothing from the pull request.** It reads the checked-out base branch and the pull request's diff from the
  API. That is why it is safe with `pull_request_target` (which fork pull requests need for a token that can comment).
- **Decides nothing.** It does not close, approve or request changes. It comments and labels; `mode: summary` does
  not even do that.
- **Skips maintainers and bots** by default (`check-maintainers: true` to include them).
- **Never blames the contributor for the workflow's setup:** on a `pull_request` event from a fork (a read-only
  token) it writes the job summary only, and a token that cannot write gives a warning, not a failed check.

## Use

`.github/workflows/pr-proof.yml`:

```yaml
name: pr-proof
on:
  pull_request_target:
    types: [opened, edited, synchronize, reopened]
  issues:
    types: [opened, edited]
permissions:
  contents: read
  issues: write
  pull-requests: write
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      # The base branch (the default for pull_request_target): nothing from the pull request is checked out.
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - uses: zch6a/pr-proof@v0.2.0
        with:
          mode: summary # start with the job summary only; switch to "comment" when you like what it says
```

| Input | Default | |
|---|---|---|
| `mode` | `comment` | `comment`: one comment (edited on later runs) and the label. `summary`: only the job summary, a dry run |
| `label` | `needs-evidence` | added while something is unverified, removed when everything checks out; empty for none |
| `check-maintainers` | `false` | also check owners, members and collaborators |
| `fail-on-unverified` | `false` | fail the job when something could not be verified |
| `github-token` | `${{ github.token }}` | reads the pull request's files and issues; writes the comment and label |

Output: `unverified`, the number of statements that could not be verified.

It works next to tools that look at how a pull request is made, such as [anti-slop](https://github.com/peakoss/anti-slop)
(branch names, size, templates, account age): they check the form, pr-proof checks the facts.

## On the command line

Check a description before you post it, or an issue while triaging, against a local checkout (Node 20 or later):

```bash
npx -y github:zch6a/pr-proof description.md                    # files, functions, options: offline
npx -y github:zch6a/pr-proof description.md --base origin/main  # as a pull request: your branch's changes count
npx -y github:zch6a/pr-proof issue.md --github owner/repo       # also issue references and CVE ids (network)
```

Exit code 0 when everything checked was found, 1 when something could not be verified.

## Limits

- **A name in a dependency is reported.** `requests.get()` is found if `get` appears anywhere in your repository,
  which it usually does; a function only a dependency has is not. The comment says how to answer.
- Function and option names are checked only when the whole repository (up to 300 MB of text; source files up to
  16 MB, UTF-8 or UTF-16) and the whole diff could be read; otherwise they are listed as not checked, never as
  missing. References and advisories that could not be looked up (rate limits, a repository the token cannot see)
  are listed as not checked too.
- "Adds tests" and "updates the docs" are recognised in English, and test and documentation files by their names and
  folders (`tests/`, `*.test.ts`, `test_*.py`, `*_test.go`, `docs/`, `README`, `*.md`).
- The command line reads committed and staged files (`git ls-files`); a new file is found once it is added.
- GitHub-hosted repositories; on GitHub Enterprise, GHSA ids that its API does not know are listed as not checked.

## What it sends

The GitHub API calls of the Action (with the workflow's token): the pull request's files, the issues it references,
its own comment and label, GHSA ids. CVE ids go to the CVE list's public API (cveawg.mitre.org). Nothing else, and
nothing to any other service.

## Develop

```bash
npm ci
npm test        # claims, verification, the Action against a stand-in API, the command line
npm run check   # type-check (JSDoc + tsc)
```

Tests use throwaway repositories in the temp folder and a local stand-in for the GitHub API; no test touches the
network.

## License

[MIT](LICENSE)
