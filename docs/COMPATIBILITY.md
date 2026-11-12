# Compatibility

What pr-proof 1.x keeps stable, so a workflow written for 1.0 keeps working, and so does a script that reads the
command line's JSON. Changing any of it means 2.0. `test/contract.test.js` checks this page against the code.

## Versions

- `zch6a/pr-proof@v1` moves to every 1.x release; `@v1.0.0` (or a commit) stays put.
- `@v0` stays at 0.5.0. Moving from `@v0` to `@v1` needs no other change: the inputs, the output and the comment are
  the same.

## The Action

**Inputs** (names and defaults):

| Input | Default |
|---|---|
| `mode` | `comment` (`comment` or `summary`) |
| `label` | `needs-evidence` (empty: no label) |
| `ignore` | empty |
| `issue-names` | `false` |
| `check-maintainers` | `false` |
| `fail-on-unverified` | `false` |
| `github-token` | `${{ github.token }}` |

**Output**: `unverified`, the number of statements that could not be verified.

**Events**: `pull_request_target`, `pull_request` and `issues`, on `opened`, `edited`, `reopened`, `synchronize` and
`ready_for_review`. Other events and actions are a no-op (a line in the log, a green check).

**The comment**: at most one per pull request or issue, found again by its first line, `<!-- pr-proof -->`, and edited
on later runs; once everything checks out, it says so. Each row names a kind: File, Function, Option, Reference,
Fixes, Advisory, Tests, Docs. The label is added while something is unverified and removed when nothing is.

**When the job fails**: only with `fail-on-unverified: true` and something unverified, or for the workflow's setup
(no checkout, an unknown `mode`). GitHub not answering, a read-only token, a locked conversation: a warning, never a
failed check.

**What it reads and sends**: the checked-out base branch; the pull request's files, the issues it references and the
advisory ids it names, from the GitHub API with the workflow's token; CVE ids from the CVE list's public API. Nothing
from the pull request is checked out or run. A 1.x release adds no other destination.

## The command line

```
pr-proof <file | -> [--repo DIR] [--base REF] [--github OWNER/REPO] [--ignore NAMES] [--json]
pr-proof --help | --version
```

**Exit codes**: `0` everything checked was found, `1` something could not be verified, `2` usage or other errors.

**JSON** (`--json`):

| Field | |
|---|---|
| `version` | the pr-proof version |
| `unverified` | list of `{kind, said, line, detail}`; `kind` is one of `path`, `symbol`, `option`, `ref`, `fixes`, `advisory`, `tests`, `docs`; `line` is the line of the text, `0` for a title |
| `checked` | counts: `paths`, `symbols`, `options`, `refs`, `advisories`, `statements` |
| `notChecked` | list of what could not be checked, with why |
| `claims` | everything recognised in the text |

Without `--github` nothing goes over the network.

## What may change in 1.x

- **What counts as a claim, and how strictly it is checked.** The direction is fewer false alarms: a release may stop
  reporting something an earlier one reported, or start checking something new.
- **New kinds** of statements, inputs, JSON fields and command-line options may be added; a script should ignore a
  `kind` or a field it does not know.
- **The wording**: the comment's sentences, `detail`, `notChecked`, and the shape of `claims`, which is there for
  debugging.
- `src/` is not a library: its functions can change in any release.
- The Action runs on the runtime GitHub provides (`node24` now); the command line needs Node 20 or later.
