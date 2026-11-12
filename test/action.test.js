// @ts-check
// The Action as GitHub runs it (src/action.js with an event file, a workspace and INPUT_* variables), against a
// local stand-in for the GitHub API; and the command line.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { PROJECT, fakeGithub, git, makeRepo, write } from "./helpers.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Runs the Action. @param {{event: object, name: string, workspace: string, api: string, inputs?: Record<string, string>}} o */
function runAction(o) {
  const dir = mkdtempSync(join(tmpdir(), "pr-proof-run-"));
  const eventPath = join(dir, "event.json");
  writeFileSync(eventPath, JSON.stringify(o.event));
  const summary = join(dir, "summary.md");
  const outputs = join(dir, "outputs.txt");
  writeFileSync(summary, "");
  writeFileSync(outputs, "");
  const env = {
    ...process.env,
    GITHUB_EVENT_NAME: o.name, GITHUB_EVENT_PATH: eventPath, GITHUB_REPOSITORY: "acme/widget", GITHUB_WORKSPACE: o.workspace,
    GITHUB_API_URL: o.api, PR_PROOF_CVE_API: o.api, GITHUB_STEP_SUMMARY: summary, GITHUB_OUTPUT: outputs, INPUT_GITHUB_TOKEN: "test-token",
    ...Object.fromEntries(Object.entries(o.inputs ?? {}).map(([k, v]) => [`INPUT_${k.toUpperCase()}`, v])),
  };
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [join(ROOT, "src", "action.js")], { env });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("close", (code) => {
      const result = { code, out, summary: readFileSync(summary, "utf8"), outputs: readFileSync(outputs, "utf8") };
      rmSync(dir, { recursive: true, force: true });
      resolve(result);
    });
  });
}

const pr = (/** @type {string} */ body, /** @type {string} */ association = "CONTRIBUTOR") => ({
  action: "opened",
  pull_request: { number: 5, title: "Fix sync", body, user: { type: "User", login: "someone" }, author_association: association, head: { sha: "abc" } },
});

test("a pull request with statements that do not check out: one comment, the label, the output", async (t) => {
  const repo = makeRepo(PROJECT);
  const gh = /** @type {any} */ (await fakeGithub({ issues: { 3: "issue" }, files: [{ filename: "src/widget/sync.py", status: "modified", patch: "+    return items\n" }] }));
  t.after(() => { gh.close(); repo.cleanup(); });
  const body = "Fixes #3 and #404. The crash is in `src/widget/tokens.py` (`refresh_token_cache()`). This adds tests.";
  const r = /** @type {any} */ (await runAction({ event: pr(body), name: "pull_request_target", workspace: repo.dir, api: gh.url }));
  assert.equal(r.code, 0, r.out);
  assert.match(r.outputs, /unverified=4/);
  const posted = gh.requests.filter((/** @type {any} */ q) => q.method === "POST" && q.url.endsWith("/issues/5/comments"));
  assert.equal(posted.length, 1);
  const comment = posted[0].body.body;
  assert.match(comment, /^<!-- pr-proof -->/);
  for (const s of ["#404", "src/widget/tokens.py", "refresh_token_cache", "adds tests"]) assert.ok(comment.includes(s), s);
  assert.ok(gh.requests.some((/** @type {any} */ q) => q.method === "POST" && q.url.endsWith("/issues/5/labels") && q.body.labels[0] === "needs-evidence"));
  assert.match(r.summary, /could not verify 4 statements/);
  assert.ok(gh.requests.every((/** @type {any} */ q) => !q.url.includes("pulls/5/merge") && !q.url.includes("/pulls/5") || q.url.includes("/files")), "only reads the files; never merges, closes or edits the pull request");

  // Fixed: the same comment is edited to say so, and the label comes off.
  const fixed = "Fixes #3. The crash is in `src/widget/sync.py` (`sync_items()`).";
  const r2 = /** @type {any} */ (await runAction({ event: { ...pr(fixed), action: "edited" }, name: "pull_request_target", workspace: repo.dir, api: gh.url }));
  assert.equal(r2.code, 0, r2.out);
  assert.equal(gh.requests.filter((/** @type {any} */ q) => q.method === "POST" && q.url.endsWith("/issues/5/comments")).length, 1, "no second comment");
  const patch = gh.requests.find((/** @type {any} */ q) => q.method === "PATCH");
  assert.match(patch?.body.body ?? "", /everything in this pull request that could be checked against the repository was found/);
  assert.ok(gh.requests.some((/** @type {any} */ q) => q.method === "DELETE" && q.url.endsWith("/labels/needs-evidence")));
});

test("quiet when everything checks out and there was no comment; maintainers and bots are skipped; summary mode writes nothing", async (t) => {
  const repo = makeRepo(PROJECT);
  const gh = /** @type {any} */ (await fakeGithub({ files: [] }));
  t.after(() => { gh.close(); repo.cleanup(); });
  const fine = /** @type {any} */ (await runAction({ event: pr("Touches `src/widget/cache.py`."), name: "pull_request_target", workspace: repo.dir, api: gh.url }));
  assert.equal(fine.code, 0, fine.out);
  assert.ok(!gh.requests.some((/** @type {any} */ q) => q.method !== "GET" && !(q.method === "DELETE" && q.url.endsWith("/labels/needs-evidence"))), "nothing written but taking a label off");
  const maint = /** @type {any} */ (await runAction({ event: pr("`made_up()`", "MEMBER"), name: "pull_request_target", workspace: repo.dir, api: gh.url }));
  assert.match(maint.out, /member of the repository, not checked/);
  const bot = /** @type {any} */ (await runAction({ event: { action: "opened", pull_request: { ...pr("x").pull_request, user: { type: "Bot" } } }, name: "pull_request_target", workspace: repo.dir, api: gh.url }));
  assert.match(bot.out, /opened by a bot/);
  const before = gh.requests.length;
  const dry = /** @type {any} */ (await runAction({ event: pr("`src/nope.py`"), name: "pull_request_target", workspace: repo.dir, api: gh.url, inputs: { mode: "summary" } }));
  assert.match(dry.summary, /src\/nope\.py/);
  assert.ok(!gh.requests.slice(before).some((/** @type {any} */ q) => q.method !== "GET"), "summary mode writes nothing");
});

test("an issue: names checked against the default branch, references through the API", async (t) => {
  const repo = makeRepo(PROJECT);
  const gh = /** @type {any} */ (await fakeGithub({ issues: {}, cves: ["CVE-2024-3094"] }));
  t.after(() => { gh.close(); repo.cleanup(); });
  const event = { action: "opened", issue: { number: 8, title: "Crash", body: "Since #77, `Cache.flush_all()` crashes (CVE-2024-3094, CVE-2025-99999).", user: { type: "User" }, author_association: "NONE" } };
  const r = /** @type {any} */ (await runAction({ event, name: "issues", workspace: repo.dir, api: gh.url }));
  assert.equal(r.code, 0, r.out);
  assert.match(r.outputs, /unverified=3/);
  const comment = gh.requests.find((/** @type {any} */ q) => q.method === "POST" && q.url.endsWith("/issues/8/comments"))?.body.body ?? "";
  assert.match(comment, /flush_all/);
  assert.match(comment, /#77/);
  assert.match(comment, /CVE-2025-99999/);
  assert.doesNotMatch(comment, /CVE-2024-3094 in the CVE list/);
});

test("without a checkout it says what to add, and fails", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "pr-proof-empty-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = /** @type {any} */ (await runAction({ event: pr("x"), name: "pull_request_target", workspace: dir, api: "http://127.0.0.1:9" }));
  assert.equal(r.code, 1);
  assert.match(r.out, /needs the repository checked out/);
});

test("the command line: offline against a checkout, and as a pull request with --base", async (t) => {
  const repo = makeRepo(PROJECT);
  t.after(repo.cleanup);
  const cli = (/** @type {string[]} */ args, /** @type {string} */ input) => new Promise((resolve) => {
    const p = spawn(process.execPath, [join(ROOT, "src", "cli.js"), ...args], { cwd: repo.dir });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("close", (code) => resolve({ code, out }));
    p.stdin.end(input);
  });
  const a = /** @type {any} */ (await cli(["-"], "See `src/widget/sync.py` and `src/widget/gone.py`; fixes #1."));
  assert.equal(a.code, 1);
  assert.match(a.out, /gone\.py/);
  assert.match(a.out, /Not checked: issue references \(no GitHub access\)/);
  // A branch that adds the file and a test: with --base it is a pull request, and its own changes count.
  git(repo.dir, ["checkout", "-q", "-b", "feature"]);
  write(repo.dir, { "src/widget/gone.py": "def brand_new_thing():\n    pass\n", "tests/test_gone.py": "def test_x():\n    pass\n" });
  git(repo.dir, ["add", "-A"]);
  git(repo.dir, ["commit", "-q", "-m", "feature"]);
  const b = /** @type {any} */ (await cli(["-", "--base", "master", "--json"].map((x) => (x === "master" ? defaultBranch(repo.dir) : x)), "Adds `brand_new_thing()` in `src/widget/gone.py`. Adds tests."));
  const json = JSON.parse(b.out);
  assert.equal(b.code, 0, b.out);
  assert.deepEqual(json.unverified, []);
});

/** The first branch of a test repository (git 2.17 says master, newer may be configured otherwise). @param {string} dir */
function defaultBranch(dir) {
  return git(dir, ["for-each-ref", "--format=%(refname:short)", "refs/heads/"]).split("\n").map((s) => s.trim()).find((b) => b && b !== "feature") ?? "master";
}
