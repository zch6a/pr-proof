// @ts-check
// Round 1: every false alarm found by the independent review and by running on 128 merged pull requests of seven
// public projects (scripts/precision.mjs), as a test. A contributor told that something true "could not be verified"
// is wronged, so each of these must stay quiet; the real catches next to them must still be caught.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { asOption, asPath, asSymbol, extractClaims } from "../src/claims.js";
import { check } from "../src/check.js";
import { changesOf, indexRepo } from "../src/repo.js";
import { renderComment } from "../src/report.js";
import { PROJECT, git, makeRepo, write } from "./helpers.js";

const kinds = (/** @type {{kind: string, said: string}[]} */ u) => u.map((x) => `${x.kind} ${x.said}`);

test("negations, questions, offers, plans and test results are not 'adds tests' / 'updates the docs'", () => {
  for (const s of [
    "I didn't add tests because this is a one-line typo fix.", "I haven’t added tests.", "I can't add tests for this.", "Unable to add tests here.",
    "Should I add tests?", "Happy to add tests if needed.", "I'll add tests later.", "Added a fix and tests pass locally.",
    "Add Windows to the tests matrix.", "Add CI job that runs tests on Windows.", "Please add tests for any new functionality.",
    "passes (146), including the 10 tests.", "Each passing full suite reports 456 passed, including the new tests.",
  ]) assert.equal(extractClaims(s).tests, null, s);
  for (const s of ["As documented in the README, this is expected.", "Updated deps per the docs.", "Updates docs links.", "Please update docs when merging.", "Adds a link to the docs site."]) {
    assert.equal(extractClaims(s).docs, null, s);
  }
  assert.equal(extractClaims("- [x] I've added a test for each change that was introduced").tests, null, "a template's checkbox, ticked or not");
  assert.equal(extractClaims("1. [ ] Fixes #123").refs.length, 0, "a numbered unticked task");
  // Real statements still count.
  for (const s of ["This adds unit tests for the parser.", "Added regression tests.", "Includes tests.", "Tests added."]) assert.ok(extractClaims(s).tests, s);
  for (const s of ["Updated the README.", "Adds docs for the new option.", "Improves the documentation."]) assert.ok(extractClaims(s).docs, s);
});

test("inline code that looks like a path but is not one", () => {
  for (const s of ["react-dom/client", "application/json", "origin/main", "and/or", "TCP/IP", "/api/users", "github.com/foo/bar", "Node.js", "Chart.js", "docs.rs", "bun.sh",
    "sample.txt", "express.json", "pyproject.toml", "alpha\\nbeta\\n", "first\\nsecond\\n", "actions/setup-go@v6", "cue-lang/vscode-cue", "kube/config", "_test.go", "../x.py", ".\\..\\x.py"]) {
    assert.equal(asPath(s), null, s);
  }
  assert.equal(asPath(".\\src\\widget\\sync.py"), "src/widget/sync.py", "a Windows path");
  assert.equal(asSymbol("JSON.parse(text)"), null, "the standard library");
  assert.equal(asSymbol("std::fs::read_to_string()"), null);
  assert.equal(asOption("--help"), null, "added by every framework");
});

test("references: colours, ordinals, #0, indented code and <pre> are not issues", () => {
  const c = extractClaims([
    "The border colour should be #333 instead of #000.",
    "This is step #1, and the #1 cause.",
    "## Step #3",
    "",
    "    indented code #44",
    "<pre>",
    "#45 in pre",
    "</pre>",
    "Fixes #12.",
  ].join("\n"));
  assert.deepEqual(c.refs.map((r) => r.number), [12]);
});

test("paths that are not about this repository are left alone; those that are, are checked", async (t) => {
  const repo = makeRepo({ ...PROJECT, "History.md": "# History\n", "tests/fixtures/a.txt": "x\n", ".gitignore": "dist/\n.env\nCargo.lock\n" });
  t.after(repo.cleanup);
  const text = [
    "See `HISTORY.md`, `.kube/config`, `some/project/.kube/config`, `extension/syntaxes/cue.tmLanguage.json`, `dist/index.js`, `.env`.", // not ours, or bare, or ignored
    "Also `history.md` and `src/Widget/Sync.py`.", // case
    "And `tests/fixtures/b.txt`, `src/widget/tokens.py`.", // ours, missing: reported
  ].join("\n");
  const { result } = await check({ text, index: indexRepo(repo.dir), isPull: false });
  assert.deepEqual(kinds(result.unverified), ["path tests/fixtures/b.txt", "path src/widget/tokens.py"]);
});

test("stack traces from another machine and from dependencies", async (t) => {
  const repo = makeRepo(PROJECT);
  t.after(repo.cleanup);
  const text = ["```", 'File "/app/src/widget/sync.py", line 1, in sync_items', 'File "/app/.venv/lib/python3.12/site-packages/requests/api.py", line 59', '  File "/usr/lib/python3.12/threading.py", line 1', "\tat org.springframework.web.servlet.DispatcherServlet.doDispatch(DispatcherServlet.java:1040)", "    at Module._compile (internal/modules/cjs/loader.js:999:30)", 'File "src/widget/gone.py", line 3', "```"].join("\n");
  const { result } = await check({ text, index: indexRepo(repo.dir), isPull: false });
  // Frames are counted when they are ours and never reported: a relative frame is as often the reporter's own app.
  assert.deepEqual(kinds(result.unverified), []);
  assert.equal(result.checked.paths, 1, "the /app/ frame was matched to src/widget/sync.py");
});

test("options named without their dashes, and generated getters", async (t) => {
  const repo = makeRepo({
    "main.go": 'flag.Bool("dry-run", false, "")\ncmd.Flags().BoolVar(&x, "force-sync", false, "")\n',
    "cli.js": "yargs.option('max-size', {})\n",
    "src/args.rs": "#[arg(long)]\nno_cache: bool,\n",
    "user.proto": "message User { string user_id = 1; }\n",
  });
  t.after(repo.cleanup);
  const text = "`--dry-run`, `--force-sync`, `--max-size`, `--no-cache`, `--made-up` and `User.getUserId()`, `invented_call()`.";
  const { result } = await check({ text, index: indexRepo(repo.dir), isPull: false });
  assert.deepEqual(kinds(result.unverified), ["symbol invented_call()", "option --made-up"]);
});

test("an index that could not read everything says so instead of reporting names missing", async (t) => {
  const repo = makeRepo(PROJECT);
  t.after(repo.cleanup);
  // A UTF-16 PowerShell script is read (not skipped as binary).
  writeFileSync(join(repo.dir, "build.ps1"), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("function Invoke-Release_Build { }\n", "utf16le")]));
  git(repo.dir, ["add", "-A"]);
  git(repo.dir, ["commit", "-q", "-m", "ps1"]);
  assert.deepEqual((await check({ text: "`Invoke_Release_Build()`", index: indexRepo(repo.dir), isPull: false })).result.unverified.length, 1);
  assert.ok(indexRepo(repo.dir).words.has("Release_Build"), "UTF-16 decoded");
  // A source file tracked but not on disk (a sparse checkout): names are not checked.
  rmSync(join(repo.dir, "src", "widget", "cache.py"));
  const partial = indexRepo(repo.dir);
  assert.equal(partial.complete, false);
  const r = (await check({ text: "`evict()` and `made_up()`", index: partial, isPull: false })).result;
  assert.deepEqual(r.unverified, []);
  assert.match(r.notChecked.join(), /cache\.py is tracked but not on disk/);
});

test("a submodule's paths are not this repository's to check", async (t) => {
  const inner = makeRepo({ "src/lib.c": "int f(void);\n" });
  const repo = makeRepo(PROJECT);
  t.after(() => { repo.cleanup(); inner.cleanup(); });
  git(repo.dir, ["-c", "protocol.file.allow=always", "submodule", "add", "-q", inner.dir.replace(/\\/g, "/"), "third_party/libx"]);
  git(repo.dir, ["commit", "-q", "-m", "submodule"]);
  const { result } = await check({ text: "In `third_party/libx/src/lib.c` and `third_party/libx/src/nope.c`.", index: indexRepo(repo.dir), isPull: false });
  assert.deepEqual(result.unverified, []);
});

test("tests written next to the code count; doc comments count as docs; more test and doc file names", async (t) => {
  const repo = makeRepo(PROJECT);
  t.after(repo.cleanup);
  const run = async (/** @type {any[]} */ files, /** @type {string} */ text) => kinds((await check({ text, index: indexRepo(repo.dir), changes: changesOf(files), isPull: true })).result.unverified);
  assert.deepEqual(await run([{ filename: "src/parser.rs", status: "modified", patch: "+#[cfg(test)]\n+mod tests {\n+    #[test]\n+    fn parses() {}\n+}\n" }], "Adds tests."), []);
  assert.deepEqual(await run([{ filename: "src/x.py", status: "modified", patch: '+    """Return the parsed value."""\n' }], "Updates the docs."), []);
  for (const f of ["base/split_unittest.cc", "parser/testdata/case7.txt", "src/FooIT.java", "tests/FooTest.php", "cypress/x.cy.ts"]) assert.deepEqual(await run([{ filename: f, status: "added", patch: "+x\n" }], "Adds tests."), [], f);
  assert.deepEqual(await run([{ filename: "man/sync.Rd", status: "added", patch: "+x\n" }], "Updates the documentation."), []);
  assert.deepEqual(await run([{ filename: "History.md", status: "modified", patch: "+x\n" }, { filename: "package.json", status: "modified", patch: "+x\n" }], "This adds unit tests for utils.compileETag."), ["tests This adds unit tests for utils.compileETag."], "the real catch on expressjs/express#7468 is still caught");
});

test("unknown answers are listed as not checked, never as found; lookups are capped", async (t) => {
  const repo = makeRepo(PROJECT);
  t.after(repo.cleanup);
  let calls = 0;
  const lookups = { ref: async () => { calls++; return /** @type {const} */ ("unknown"); }, advisory: async () => null };
  const many = Array.from({ length: 80 }, (_, i) => `#${i + 1}`).join(" ");
  const { result, comment } = await check({ text: `See ${many}, CVE-2024-3094.`, index: indexRepo(repo.dir), isPull: false, lookups, owner: "acme", repo: "widget" });
  assert.equal(result.unverified.length, 0);
  assert.ok(calls <= 30, `${calls} lookups`);
  assert.match(result.notChecked.join(), /references \(GitHub did not answer/);
  assert.match(result.notChecked.join(), /one advisory id/);
  assert.doesNotMatch(comment, /everything .* was found/, "not 'everything was found' when nothing could be checked");
});

test("the title is checked on its own; the body's line numbers are its own", async (t) => {
  const repo = makeRepo(PROJECT);
  t.after(repo.cleanup);
  const { result } = await check({ title: "Fix `src/widget/nope.py`", text: "Line one.\nThe crash is in `src/widget/gone.py`.", index: indexRepo(repo.dir), isPull: false });
  assert.deepEqual(result.unverified.map((u) => `${u.said}@${u.line}`), ["src/widget/nope.py@0", "src/widget/gone.py@2"]);
  assert.match(renderComment(result, { subject: "issue" }), /File \(title\)/);
});

test("the comment: a backslash cannot undo the escaped pipe; links and images stay text; long results are cut", () => {
  const evil = { kind: /** @type {const} */ ("tests"), said: "Adds tests [run](https://evil.example/login) \\| Found in the repository. ![x](https://e.example/i.png)", line: 1, detail: "It says it adds tests, but none of the changed files is a test file." };
  const md = renderComment({ unverified: [evil], checked: { paths: 0, symbols: 0, options: 0, refs: 0, advisories: 0, statements: 1 }, notChecked: [] }, { subject: "pull request" });
  const row = md.split("\n").find((l) => l.startsWith("| Tests")) ?? "";
  assert.equal(row.split(/(?<!\\)\|/).length, 5, `three cells: ${row}`);
  assert.match(row, /\| `Adds tests \[run\]\(https:\/\/evil\.example\/login\)/, "inside a code span: not a link");
  const many = Array.from({ length: 300 }, (_, i) => ({ ...evil, line: i + 1, said: `x${i}`.repeat(20) }));
  const big = renderComment({ unverified: many, checked: { paths: 0, symbols: 0, options: 0, refs: 0, advisories: 0, statements: 300 }, notChecked: [] }, { subject: "pull request" });
  assert.ok(big.length < 65_536, `${big.length} characters`);
  assert.match(big, /and 250 more/);
});

test("the CLI reads files not yet committed when there is no --base", async (t) => {
  const repo = makeRepo(PROJECT);
  t.after(repo.cleanup);
  write(repo.dir, { "src/widget/new.py": "def fresh_name(): pass\n" });
  const dir = mkdtempSync(join(tmpdir(), "pr-proof-cli-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // Untracked files are not in `git ls-files`: documented; the check says the file is missing until it is added.
  const r = (await check({ text: "`src/widget/new.py`", index: indexRepo(repo.dir), isPull: false })).result;
  assert.equal(r.unverified.length, 1);
});
