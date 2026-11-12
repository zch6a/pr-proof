// @ts-check
// Round 4: the second independent review's findings, each as a test. False alarms must stay quiet; the real
// problems next to them (and the ones the review found were not caught at all) must be caught.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { asOption, asPath, asSymbol, extractClaims } from "../src/claims.js";
import { check } from "../src/check.js";
import { changesOf, indexRepo } from "../src/repo.js";
import { PROJECT, fakeGithub, git, makeRepo, write } from "./helpers.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const tests = (/** @type {string} */ s) => extractClaims(s).tests;

test("not claims of adding tests: existing tests, removals, template answers, test ids and plans, speed, copied notes", () => {
  for (const s of [
    "Covered by existing tests.", "Removes the flaky test added in #3.", "Tests added: No", "**Tests added?** No", "Added tests: none needed (docs only).",
    "[ ] Tests added", "- [-] Tests added (N/A)", "❌ Tests added", "Adds a test id to the submit button.", "Adds a test-only export.",
    "Includes a test plan below.", "Adds a test database container.", "Adds caching to speed up tests on CI.",
    "* Added tests for parser by @bob in https://github.com/other/lib/pull/457",
    "<blockquote>\n<li>Added tests for parser</li>\n</blockquote>",
  ]) assert.equal(extractClaims(s).tests, null, s);
  assert.equal(extractClaims("Added tests: none needed (docs only).").docs, null);
  for (const s of ["Adds tests for the parser.", "Added a regression test.", "Tests added.", "This adds unit tests for utils.compileETag."]) assert.ok(tests(s), s);
});

test("the statement is quoted as written, code included", () => {
  const t = extractClaims("Updates the doc comment of `parse()` and adds a test for `render()`.").tests;
  assert.equal(t?.text, "Updates the doc comment of `parse()` and adds a test for `render()`.");
});

test("tests and docs inside the code: more test markers, test files and doc comments", async (t) => {
  const repo = makeRepo(PROJECT);
  t.after(repo.cleanup);
  const run = async (/** @type {any[]} */ files, /** @type {string} */ text) => (await check({ text, index: indexRepo(repo.dir), changes: changesOf(files), isPull: true })).result.unverified.map((u) => u.kind);
  for (const [file, patch] of [
    ["src/lib.rs", '+#[tokio::test(flavor = "multi_thread")]\n+async fn x() {}\n'],
    ["src/lib.rs", "+#[rstest]\n+fn x() {}\n"],
    ["src/Lib.UnitTests/ParserShould.cs", "+    [Fact]\n+    public void Parses() {}\n"],
    ["index.test-d.ts", "+expectType<string>(x);\n"],
    ["test.js", "+  t.is(a, b);\n"],
    ["polls/tests.py", "+        self.assertEqual(a, b)\n"],
    ["t/bar.t", "+ok(1);\n"],
  ]) assert.deepEqual(await run([{ filename: file, status: "modified", patch }], "Adds tests."), [], file);
  for (const [file, patch] of [
    ["src/x.py", '+    Returns the parsed value.\n+    """\n'],
    ["src/x.js", "+ * Returns the parsed value.\n"],
    ["cmd/root.go", "+// Execute runs the root command.\n"],
    ["CHANGES", "+* Fix x\n"],
    ["newsfragments/12345.bugfix", "+Fix x\n"],
  ]) assert.deepEqual(await run([{ filename: file, status: "modified", patch }], "Updates the docs."), [], file);
  assert.deepEqual(await run([{ filename: "src/x.py", status: "modified", patch: "+    # just a comment\n" }], "Updates the docs."), ["docs"], "a plain comment is not documentation");
});

test("references: link text, other trackers and unfenced stack frames are not this repository's issues", () => {
  const refs = (/** @type {string} */ s) => extractClaims(s).refs.map((r) => `${r.owner ?? ""}/${r.repo ?? ""}#${r.number}${r.closing ? " closing" : ""}`);
  assert.deepEqual(refs("Fix crash ([#456](https://github.com/other/lib/issues/456))"), ["other/lib#456"]);
  assert.deepEqual(refs('See <a href="https://github.com/other/lib/pull/12345">#12345</a>.'), ["other/lib#12345"]);
  assert.deepEqual(refs("ticket #4521, Debian bug #1012345, Mozilla bug #1823456"), []);
  assert.deepEqual(refs("#0 /var/www/app/vendor/x.php(12): f()\n#1 /var/www/app/index.php(3): g()\n#18 {main}"), []);
  assert.deepEqual(refs("#1  0x00007f in main () at main.c:3"), []);
  // Closing keywords through a link and in bold are read (they were missed).
  assert.deepEqual(refs("Fixes [#7](https://github.com/o/r/pull/7)"), ["o/r#7 closing"]);
  assert.deepEqual(refs("Fixes **#7**"), ["/#7 closing"]);
});

test("names in links to other projects, standard libraries of more languages, options of other tools", () => {
  const c = extractClaims("Ported from [`src/utils/backoff.ts`](https://github.com/other/lib/blob/main/src/utils/backoff.ts) like [`computeBackoff()`](https://github.com/other/lib).");
  assert.deepEqual([c.paths, c.symbols], [[], []]);
  for (const s of ["Thread.sleep()", "Executors.newFixedThreadPool()", "Collectors.toUnmodifiableList()", "Files.readString()", "task.ConfigureAwait(false)", "ArgumentNullException.ThrowIfNull()", "str_contains()", "eval()", "breakpoint()", "maps.Keys()", "Task.detached()"]) {
    assert.equal(asSymbol(s), null, s);
  }
  for (const o of ["--force-with-lease", "--legacy-peer-deps", "--no-verify"]) assert.equal(asOption(o), null, o);
  assert.equal(asOption("--dry-run"), "--dry-run", "a project's own option is still checked");
});

test("files the review found were never checked are checked now", () => {
  for (const p of ["src/main.rs", "scripts/build.sh", "base/strings/string_util.cc", "src/components/Header.js", "lib/fn.jl", "src/k.zig", "kernels/x.cu", "contracts/T.sol", "infra/main.tf"]) assert.equal(asPath(p), p, p);
});

test("an indented fence (in a list) is code; an unclosed comment hides the rest, as on GitHub", () => {
  const c = extractClaims("1. Run:\n\n    ```sh\n    git commit -m \"Adds tests\" && cat `src/example/app.ts`\n    ```\n");
  assert.equal(c.tests, null);
  assert.deepEqual(c.paths, []);
  assert.equal(extractClaims("Fix.\n<!-- Please add tests for any new functionality.\nAdds tests.").tests, null);
});

test("a long run of letters is linear, not quadratic, in the index and in patches", async (t) => {
  const repo = makeRepo({ ...PROJECT, "fixtures/blob.txt": `x${"a".repeat(256 * 1024)}\n` });
  t.after(repo.cleanup);
  let t0 = performance.now();
  indexRepo(repo.dir);
  assert.ok(performance.now() - t0 < 5000, `index took ${Math.round(performance.now() - t0)} ms`);
  t0 = performance.now();
  changesOf([{ filename: "a.txt", status: "added", patch: `+${"b".repeat(256 * 1024)}-c\n` }]);
  assert.ok(performance.now() - t0 < 2000, `patch took ${Math.round(performance.now() - t0)} ms`);
});

test("a pull request with more files than the API lists has incomplete changes", () => {
  const files = Array.from({ length: 3 }, (_, i) => ({ filename: `f${i}.ts`, status: "added", patch: "+x\n" }));
  files.push(/** @type {any} */ ({ filename: "(more files than the API lists)", status: "modified" }));
  assert.equal(changesOf(files).patchesComplete, false);
});

/** Runs the Action against a stand-in API that can be told to fail. */
function runAction(/** @type {any} */ o) {
  return import("node:fs").then(({ mkdtempSync, writeFileSync, readFileSync, rmSync }) => import("node:os").then(({ tmpdir }) => {
    const dir = mkdtempSync(join(tmpdir(), "pr-proof-run-"));
    writeFileSync(join(dir, "event.json"), JSON.stringify(o.event));
    writeFileSync(join(dir, "summary.md"), "");
    writeFileSync(join(dir, "out.txt"), "");
    const env = { ...process.env, GITHUB_EVENT_NAME: o.name, GITHUB_EVENT_PATH: join(dir, "event.json"), GITHUB_REPOSITORY: "acme/widget", GITHUB_WORKSPACE: o.workspace, GITHUB_API_URL: o.api, PR_PROOF_CVE_API: o.api, GITHUB_STEP_SUMMARY: join(dir, "summary.md"), GITHUB_OUTPUT: join(dir, "out.txt"), INPUT_GITHUB_TOKEN: "t" };
    return new Promise((resolve) => {
      const p = spawn(process.execPath, [join(ROOT, "src", "action.js")], { env });
      let out = "";
      p.stdout.on("data", (d) => (out += d));
      p.on("close", (code) => { const s = readFileSync(join(dir, "summary.md"), "utf8"); rmSync(dir, { recursive: true, force: true }); resolve({ code, out, summary: s }); });
    });
  }));
}

test("GitHub failing is never the contributor's red check; a deleted comment is written again; no duplicate", async (t) => {
  const repo = makeRepo(PROJECT);
  const gh = /** @type {any} */ (await fakeGithub({ files: [] }));
  t.after(() => { gh.close(); repo.cleanup(); });
  const event = { action: "opened", pull_request: { number: 5, title: "x", body: "`src/nope.py`", user: { type: "User" }, author_association: "NONE" } };
  // The files list fails (an outage): a warning and the summary, exit 0.
  const broken = /** @type {any} */ (await fakeGithub({ files: [] }));
  broken.close();
  const r1 = /** @type {any} */ (await runAction({ event, name: "pull_request_target", workspace: repo.dir, api: "http://127.0.0.1:9" }));
  assert.equal(r1.code, 0, r1.out);
  assert.match(r1.out, /::warning::pr-proof: could not read the pull request's files/);
  // A comment that was found and then deleted: PATCH 404 → a new comment.
  gh.comments.push({ id: 77, body: "<!-- pr-proof -->\nold", user: { type: "Bot" } });
  const deleted = gh.comments.splice(0, 1);
  void deleted;
  const r2 = /** @type {any} */ (await runAction({ event, name: "pull_request_target", workspace: repo.dir, api: gh.url }));
  assert.equal(r2.code, 0, r2.out);
  assert.equal(gh.comments.filter((/** @type {any} */ c) => c.body.startsWith("<!-- pr-proof -->")).length, 1, "one comment");
});

test("the command line's --base works whatever diff.noprefix says", async (t) => {
  const repo = makeRepo(PROJECT);
  t.after(repo.cleanup);
  const base = git(repo.dir, ["rev-parse", "HEAD"]).trim();
  git(repo.dir, ["config", "diff.noprefix", "true"]);
  write(repo.dir, { "tests/test_new.py": "def test_x():\n    pass\n" });
  git(repo.dir, ["add", "-A"]);
  git(repo.dir, ["commit", "-q", "-m", "test"]);
  const r = /** @type {any} */ (await new Promise((resolve) => {
    const p = spawn(process.execPath, [join(ROOT, "src", "cli.js"), "-", "--base", base], { cwd: repo.dir });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("close", (code) => resolve({ code, out }));
    p.stdin.end("Adds tests.");
  }));
  assert.equal(r.code, 0, r.out);
});

test("a release pull request's copied notes are other pull requests' words (expressjs/express#7468)", () => {
  const body = [
    "## What's Changed",
    "* test: added unit tests for utils.compileETag to cover valid and invalid inputs by @sukdev24 in https://github.com/expressjs/express/pull/6534",
    "* build(deps): bump actions/checkout from 6.0.0 to 6.0.1 by @dependabot[bot] in https://github.com/expressjs/express/pull/6963",
    "* @AkaHarshit made their first contribution in https://github.com/expressjs/express/pull/6903",
    "",
    "This release adds tests for the router.",
  ].join("\n");
  const c = extractClaims(body);
  assert.deepEqual(c.refs, [], "no reference from copied notes");
  assert.equal(c.tests?.text, "This release adds tests for the router.", "the author's own statement still counts");
});
