# Security

pr-proof runs in workflows with a token that can write comments and labels, on text written by anyone who opens a
pull request or an issue. Both are part of its threat model.

## What it does

- **Runs nothing from the pull request.** It reads the checked-out base branch (`git ls-files`, file contents) and
  the pull request's diff from the API. It does not check out, build, install, import or execute the pull request's
  code, which is what makes it safe under `pull_request_target`.
- **Uses the token only for this:** listing the pull request's files, looking up the issues, pull requests,
  discussions and GHSA advisories the text references, and writing its own comment (found again by a marker) and
  its label. It never closes, merges, approves or edits anything else. CVE ids are looked up on the CVE list's public
  API (cveawg.mitre.org) without the token.
- **Bounded:** at most 40 claims of each kind and 30 lookups per check, and the comment is cut under GitHub's limit,
  so a long text cannot use up the token's API budget or make the job fail.
- **Hostile text stays text.** Everything quoted from the contribution is shown inside code spans, with backticks,
  backslashes and pipes neutralised: it cannot mention anyone, render links, images or HTML, or break out of the
  table into the "Checked" column.
- **No runtime dependencies**, and the workflows pin their actions to commits and run tests with a read-only token.

## Recommended workflow permissions

```yaml
permissions:
  contents: read
  issues: write
  pull-requests: write
```

and `persist-credentials: false` on the checkout. Do not add a step after pr-proof that checks out or runs the pull
request's head under `pull_request_target`.

## What it does not protect against

- **A maintainer relying on it alone.** It checks facts it can look up; a statement it cannot check is not proven
  true. It is a triage aid, not a review.
- **Repositories it can only partly read:** names are then listed as not checked.

## Reporting a vulnerability

Please open a private security advisory on GitHub (Security → Report a vulnerability) rather than a public issue,
with the text and the event that show the problem.
