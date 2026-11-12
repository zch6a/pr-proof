# Contributing

Thanks for helping. One thing matters more here than in most projects: pr-proof comments on other people's work.
A wrong comment wrongs a contributor.

## A false alarm is the worst bug

Seen one? [Report it](https://github.com/zch6a/pr-proof/issues/new?template=false-alarm.yml) with the sentence and the row of the comment: that is the most useful issue
this project gets.

Telling someone that a true statement "could not be verified" is worse than missing a false one. So:

- **When unsure, do not report.** A mention that may not be about this repository (a bare file name, a slashed
  word, a library) is left out; an answer that would prove nothing (a partial index, a lookup that failed) is
  listed as "not checked", never as missing.
- **Every new kind of claim, or new pattern, needs tests both ways:** that the real case is caught, and that the
  look-alikes are not (see `test/review1.test.js`).
- **Run the precision check** before a pull request that changes what is extracted or how it is verified:

  ```bash
  node scripts/precision.mjs   # needs network and a GitHub token (GITHUB_TOKEN or `gh auth token`)
  ```

  It checks the merged pull requests and closed issues of eleven public projects against a baseline
  (`scripts/corpus.json`). A new
  flag there is almost always a false alarm: fix it, or explain in the pull request why it is a real catch and
  update the baseline with `--update`.

## Facts, not judgements

The comment states what was checked and what was found. It never says, or hints, how a contribution was written
or that it is low quality, and it says how to answer. Keep new messages that way, and keep text from the
contribution inside code spans (`src/report.js`).

## Nothing from the pull request runs

pr-proof reads the checked-out base branch and the diff from the API. It must never check out, build, import or
run anything from the pull request: that is what makes it safe under `pull_request_target`.

## No AI, no dependencies

Every result must be checkable by hand. The Action has no runtime dependencies (it runs `src/action.js` directly);
keep it that way.

## Before a pull request

```bash
npm ci
npm test        # no test touches the network: throwaway repositories and a local stand-in for the GitHub API
npm run check   # type-check (JSDoc + tsc)
```
