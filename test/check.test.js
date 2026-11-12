// @ts-check
// Claims, the repository index and verification, on throwaway repositories.
import assert from "node:assert/strict";
import { test } from "node:test";

import { asOption, asPath, asSymbol, extractClaims } from "../src/claims.js";
import { check } from "../src/check.js";
import { changesOf, indexRepo } from "../src/repo.js";
import { quote, renderComment } from "../src/report.js";
import { PROJECT, makeRepo } from "./helpers.js";

test("paths, functions and options in inline code; what is not one", () => {
  assert.equal(asPath("src/widget/sync.py"), "src/widget/sync.py");
  assert.equal(asPath("./src/widget/sync.py:12"), "src/widget/sync.py");
  assert.equal(asPath("src/widget/sync.py#L4"), "src/widget/sync.py");
  assert.equal(asPath("sync.py"), null, "a bare name is too often not this repository's file");
  assert.equal(asPath("src/widget/"), "src/widget");
  for (const no of ["https://x.example/a.js", "~/x.py", "/etc/hosts", "C:\\x\\y.py", "*.py", "path/to/file.js", "os.path.join", "1.2.3", "npm test", "node_modules/x/y.js", "../outside.js"]) assert.equal(asPath(no), null, no);
  assert.equal(asSymbol("refresh_token_cache()"), "refresh_token_cache");
  assert.equal(asSymbol("Cache.evict(key)"), "evict");
  assert.equal(asSymbol("Widget::sync()"), "sync");
  assert.equal(asSymbol("f()"), null, "too short to mean anything");
  assert.equal(asSymbol("sync"), null, "without parentheses: not taken for a function");
  assert.equal(asOption("--dry-run"), "--dry-run");
  assert.equal(asOption("--max-size=10"), "--max-size");
  assert.equal(asOption("-v"), null);
});

test("references, closing keywords and advisories; not in comments, quotes, URLs or code", () => {
  const c = extractClaims([
    "Fixes #12, see #13 and acme/other#4. Resolves https://github.com/acme/widget/issues/7",
    "<!-- Closes #99 -->",
    "> #98 in a quote",
    "See https://example.com/page#3 and `#97` in code.",
    "Patched CVE-2024-3094 and GHSA-r9hx-vwmv-q579.",
  ].join("\n"));
  assert.deepEqual(c.refs.map((r) => `${r.owner ?? ""}/${r.repo ?? ""}#${r.number}${r.closing ? " closing" : ""}`).sort(), ["/#12 closing", "/#13", "acme/other#4", "acme/widget#7 closing"].sort());
  assert.deepEqual(c.advisories.map((a) => a.text), ["CVE-2024-3094", "GHSA-r9hx-vwmv-q579"]);
});

test("statements about tests and docs, and what does not count as one", () => {
  assert.ok(extractClaims("This adds unit tests for the parser.").tests);
  assert.ok(extractClaims("Tests added.").tests);
  assert.ok(extractClaims("Updated the README.").docs);
  for (const no of ["No tests yet.", "I will add tests later.", "- [ ] I added tests", "Without tests, as discussed.", "Tests to be added in a follow-up."]) assert.equal(extractClaims(no).tests, null, no);
});

test("an unticked template checkbox says nothing: no references, files or statements from it", () => {
  const c = extractClaims("- [ ] Fixes #123\n- [ ] I updated `docs/usage.md` and added tests\n- [x] Fixes #7");
  assert.deepEqual(c.refs.map((r) => r.number), [7]);
  assert.deepEqual(c.paths, []);
  assert.equal(c.tests, null);
});

test("stack traces in code blocks name files; other code in blocks does not count", () => {
  const c = extractClaims(["```", 'File "src/widget/sync.py", line 3, in sync_items', "    at handler (src/server/route.ts:12:5)", "  src/main.go:44 +0x1d", "made_up_call()", "```"].join("\n"));
  assert.deepEqual(c.paths.map((p) => p.text), ["src/widget/sync.py", "src/server/route.ts", "src/main.go"]);
  assert.deepEqual(c.symbols, []);
});

test("against a repository: what exists is found, what does not is said, with the line", async (t) => {
  const repo = makeRepo(PROJECT);
  t.after(repo.cleanup);
  const text = [
    "The bug is in `src/widget/sync.py`: `sync_items()` ignores `--dry-run`.",
    "It also needs `Cache.evict()` and `widget/sync.py` (relative to src/).",
    "Calling `refresh_token_cache()` in `src/widget/tokens.py` with `--force-sync` fixes it.",
  ].join("\n");
  const { result } = await check({ text, index: indexRepo(repo.dir), isPull: false });
  assert.deepEqual(result.unverified.map((u) => `${u.kind} ${u.said} @${u.line}`), ["path src/widget/tokens.py @3", "symbol refresh_token_cache() @3", "option --force-sync @3"]);
  assert.equal(result.checked.paths, 2, "widget/sync.py is not checked: widget is not a top-level folder");
  assert.match(result.unverified.find((u) => u.kind === "path")?.detail ?? "", /No file or folder `src\/widget\/tokens\.py` in this repository \(at [0-9a-f]{7}\)\./);
});

test("a pull request: what it adds is not missing; 'adds tests' needs a test file; 'updates docs' needs docs", async (t) => {
  const repo = makeRepo(PROJECT);
  t.after(repo.cleanup);
  const text = "Adds `refresh_token_cache()` in `src/widget/tokens.py` with a `--force-sync` option. This adds tests and updates the docs.";
  const changes = changesOf([{ filename: "src/widget/tokens.py", status: "added", patch: "@@ -0,0 +1,3 @@\n+def refresh_token_cache(force_sync=False):\n+    # --force-sync\n+    pass\n" }]);
  const { result } = await check({ text, index: indexRepo(repo.dir), changes, isPull: true });
  assert.deepEqual(result.unverified.map((u) => u.kind), ["tests", "docs"], "the names it adds are found in its own changes");
  const withTests = changesOf([
    { filename: "src/widget/tokens.py", status: "added", patch: "+def refresh_token_cache():\n+    '--force-sync'\n" },
    { filename: "tests/test_tokens.py", status: "added", patch: "+def test_x(): pass\n" },
    { filename: "docs/usage.md", status: "modified", patch: "+--force-sync\n" },
  ]);
  assert.deepEqual((await check({ text, index: indexRepo(repo.dir), changes: withTests, isPull: true })).result.unverified, []);
});

test("a partial index or a change without a patch: names are not checked (absence would prove nothing)", async (t) => {
  const repo = makeRepo(PROJECT);
  t.after(repo.cleanup);
  const text = "`made_up_function()` and `--made-up-option`";
  const small = indexRepo(repo.dir, { maxBytes: 10 });
  assert.equal(small.complete, false);
  const r1 = (await check({ text, index: small, isPull: false })).result;
  assert.deepEqual(r1.unverified, []);
  assert.match(r1.notChecked.join(), /function and option names/);
  const noPatch = changesOf([{ filename: "dist/bundle.js", status: "modified" }]);
  const r2 = (await check({ text, index: indexRepo(repo.dir), changes: noPatch, isPull: true })).result;
  assert.deepEqual(r2.unverified, []);
});

test("references and advisories through lookups; unknown is never reported", async (t) => {
  const repo = makeRepo(PROJECT);
  t.after(repo.cleanup);
  const states = /** @type {Record<string, import("../src/verify.js").RefState>} */ ({ "acme/widget#12": "pull", "acme/widget#13": "missing", "acme/widget#14": "issue", "acme/widget#15": "unknown" });
  const lookups = {
    ref: async (/** @type {string} */ o, /** @type {string} */ r, /** @type {number} */ n) => states[`${o}/${r}#${n}`] ?? "unknown",
    advisory: async (/** @type {string} */ id) => (id === "CVE-2024-3094" ? true : id === "CVE-2025-99999" ? false : null),
  };
  const text = "Fixes #12. Related to #13, #14 and #15. Like CVE-2024-3094, not CVE-2025-99999 or GHSA-r9hx-vwmv-q579.";
  const { result } = await check({ text, index: indexRepo(repo.dir), changes: changesOf([]), owner: "acme", repo: "widget", isPull: true, lookups });
  assert.deepEqual(result.unverified.map((u) => `${u.kind} ${u.said}`), ["fixes #12", "ref #13", "advisory CVE-2025-99999"]);
  assert.match(result.unverified[0]?.detail ?? "", /#12, which is a pull request, not an issue/);
  assert.match(result.unverified[1]?.detail ?? "", /no issue, pull request or discussion #13 in acme\/widget/);
});

test("the comment: facts and a way to answer; text from the contribution cannot ping, format or inject", async () => {
  const result = { unverified: [/** @type {const} */ ({ kind: "symbol", said: "`@octocat` <img src=x> | a `b` c", line: 2, detail: "The name `x` appears nowhere." })], checked: { paths: 1, symbols: 1, options: 0, refs: 0, advisories: 0, statements: 0 }, notChecked: [] };
  const md = renderComment(/** @type {any} */ (result), { subject: "pull request", sha: "abcdef1234" });
  assert.match(md, /^<!-- pr-proof -->/);
  assert.match(md, /could not verify one statement in this pull request/);
  assert.match(md, /not a judgement of the contribution or of how it was written/);
  // Text from the contribution is shown as code: a mention there notifies no one, HTML there is text.
  assert.match(md, /\| `'@octocat' <img src=x> \\\| a 'b' c` \|/);
  assert.equal(md.split("\n").find((l) => l.startsWith("| Function"))?.split(/(?<!\\)\|/).length, 5, "still three cells");
  assert.ok(quote("x".repeat(500)).length <= 102, "100 characters and the backticks of the code span");
  const clean = renderComment({ unverified: [], checked: { paths: 2, symbols: 1, options: 0, refs: 0, advisories: 0, statements: 0 }, notChecked: [] }, { subject: "issue" });
  assert.match(clean, /everything in this issue that could be checked against the repository was found \(3 checked\)/);
});
