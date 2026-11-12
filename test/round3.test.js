// @ts-check
// Round 3: false alarms found on a fresh sample (230 merged pull requests and 156 closed issues of eleven public
// projects), each as a test, next to the real cases that must still be caught.
import assert from "node:assert/strict";
import { test } from "node:test";

import { extractClaims } from "../src/claims.js";
import { check } from "../src/check.js";
import { changesOf, indexRepo } from "../src/repo.js";
import { PROJECT, makeRepo } from "./helpers.js";

test("'test' as an adjective is not a claim of adding tests; a test as a noun is", () => {
  for (const s of ["Added the test type-check command to the documented testing and pre-push check.", "Adds a test script to package.json.", "Adds test step for CI."]) assert.equal(extractClaims(s).tests, null, s);
  for (const s of ["Adds a test for the empty case.", "Added a regression test.", "Adds test cases for the parser.", "Adds tests."]) assert.ok(extractClaims(s).tests, s);
});

test("a function the pull request removes is named on its removed lines (facebook/docusaurus, spf13/cobra#2063)", async (t) => {
  const repo = makeRepo(PROJECT);
  t.after(repo.cleanup);
  const changes = changesOf([{ filename: "src/widget/sync.py", status: "modified", patch: "@@ -1,3 +1,1 @@\n-def get_flag_completion(name):\n-    pass\n+def get_flag_completion_func(name): pass\n" }]);
  const { result } = await check({ text: "By removing the global function `get_flag_completion()` we are more future proof.", index: indexRepo(repo.dir), changes, isPull: true });
  assert.deepEqual(result.unverified, []);
});

test("a path whose first folder is not top-level is the reader's own project, not this repository", async (t) => {
  // A monorepo: src/ only inside packages. A docs pull request about "your site's src/index.js" and "static/assets/".
  const repo = makeRepo({ "packages/core/src/main.ts": "export const x = 1;\n", "website/static/img/logo.svg": "<svg/>\n", "README.md": "# x\n" });
  t.after(repo.cleanup);
  const text = "Put it in `src/index.js` or in `static/assets/`. The core lives in `packages/core/src/main.ts`, not `packages/core/src/gone.ts`.";
  const { result } = await check({ text, index: indexRepo(repo.dir), changes: changesOf([]), isPull: true });
  assert.deepEqual(result.unverified.map((u) => u.said), ["packages/core/src/gone.ts"], "the repository's own paths are still checked");
});

test("an issue: names are the reporter's own project or proposals, so off by default; references are checked", async (t) => {
  const repo = makeRepo(PROJECT);
  t.after(repo.cleanup);
  const text = "In my app `src/lib/bread.ts` breaks. It would be nice to have `--markdown-tables`. Also `made_up()`. Since #99.";
  const lookups = { ref: async () => /** @type {const} */ ("missing"), advisory: async () => null };
  const off = (await check({ text, index: indexRepo(repo.dir), isPull: false, names: false, lookups, owner: "acme", repo: "widget" })).result;
  assert.deepEqual(off.unverified.map((u) => u.kind), ["ref"]);
  assert.match(off.notChecked.join(), /issue-names: true/);
  const on = (await check({ text, index: indexRepo(repo.dir), isPull: false, names: true, lookups, owner: "acme", repo: "widget" })).result;
  assert.ok(on.unverified.length > 1, "with names on, they are checked");
});
