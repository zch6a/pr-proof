// @ts-check
// What 1.x promises (docs/COMPATIBILITY.md) against the code, and the README's example against real output: a page
// that says something the code does not do is a bug like any other.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { check } from "../src/check.js";
import { changesOf, indexRepo } from "../src/repo.js";
import { MARKER, renderComment } from "../src/report.js";
import { PROJECT, makeRepo } from "./helpers.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (/** @type {string} */ name) => readFileSync(join(ROOT, name), "utf8").replace(/\r\n/g, "\n");
const DOC = read("docs/COMPATIBILITY.md");
const CLI = join(ROOT, "src", "cli.js");
/** @param {string[]} args @param {string} cwd */
const cli = (args, cwd) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", env: { ...process.env, GITHUB_TOKEN: "" } });

/** The rows of the first table under a heading-like line that starts with `start`. @param {string} start */
function tableAfter(start) {
  const lines = DOC.split("\n");
  const i = lines.findIndex((l) => l.startsWith(start));
  assert.ok(i >= 0, start);
  const rows = [];
  for (const l of lines.slice(i + 1)) {
    if (l.startsWith("|")) rows.push(l.split("|").slice(1, -1).map((c) => c.trim()));
    else if (rows.length) break;
  }
  return rows.slice(2);
}

/** The README's example: the text a pull request would have, on the test project, as GitHub would see it. */
async function readmeExample() {
  const repo = makeRepo(PROJECT);
  try {
    const text = [
      "Fixes #41.",
      "",
      "The crash is in `src/widget/tokens.py`: `refresh_token_cache()` is never called.",
      "Run it with `--force-sync`. This also adds regression tests.",
    ].join("\n");
    const changes = changesOf([{ filename: "src/widget/sync.py", status: "modified", patch: "@@ -1,2 +1,2 @@\n def sync_items(items, dry_run=False):\n-    return [i for i in items]\n+    return list(items)\n" }]);
    const { comment } = await check({
      text, index: indexRepo(repo.dir), changes, owner: "acme", repo: "widget", isPull: true,
      lookups: { ref: async (_o, _r, n) => (n === 41 ? "pull" : "missing"), advisory: async () => null },
    });
    return comment;
  } finally {
    repo.cleanup();
  }
}

test("the README's example is what pr-proof writes (both languages)", async () => {
  const lines = (await readmeExample()).split("\n");
  assert.equal(lines[0], MARKER);
  const sha = (/** @type {string} */ s) => s.replace(/\b(at|against) [0-9a-f]{7}\b/g, "$1 SHA");
  // The whole comment, footer included: nothing left out.
  const expected = lines.slice(1).map((l) => sha(l ? `> ${l}` : ">"));
  for (const name of ["README.md", "README.zh-CN.md"]) {
    const readme = read(name).split("\n");
    const start = readme.findIndex((l) => l.startsWith("> **pr-proof** could not verify"));
    assert.ok(start >= 0, name);
    assert.deepEqual(readme.slice(start, start + expected.length).map(sha), expected, name);
  }
});

test("the Action's inputs, defaults, output and events are the ones COMPATIBILITY.md promises", () => {
  const yml = read("action.yml");
  const inputs = [...yml.split("outputs:")[0].matchAll(/^ {2}([\w-]+):\n(?: {4}.*\n)*? {4}default: (.*)$/gm)].map((m) => [m[1], (m[2] ?? "").replace(/^"(.*)"$/, "$1")]);
  assert.equal(inputs.length, 7);
  const rows = new Map(tableAfter("**Inputs**").map(([name, def]) => [name?.replace(/`/g, ""), def ?? ""]));
  assert.deepEqual([...rows.keys()].sort(), inputs.map(([n]) => n).sort(), "the same inputs");
  for (const [name, def] of inputs) {
    const cell = rows.get(name) ?? "";
    assert.ok(def ? cell.startsWith(`\`${def}\``) : cell.startsWith("empty"), `${name}: ${def} vs ${cell}`);
  }
  assert.deepEqual([...yml.split("outputs:")[1]?.split("runs:")[0]?.matchAll(/^ {2}([\w-]+):/gm) ?? []].map((m) => m[1]), ["unverified"]);
  assert.match(DOC, /\*\*Output\*\*: `unverified`/);

  const action = read("src/action.js");
  const actions = JSON.parse((action.match(/!(\[[^\]]*"opened"[^\]]*\])\.includes\(event\.action\)/)?.[1] ?? "[]"));
  const events = DOC.split("\n\n").find((p) => p.startsWith("**Events**")) ?? "";
  for (const a of actions) assert.ok(events.includes(`\`${a}\``), a);
  for (const e of ["pull_request_target", "pull_request", "issues"]) assert.ok(action.includes(`"${e}"`) && events.includes(`\`${e}\``), e);
  assert.ok(DOC.includes(`\`${MARKER}\``), "the marker");
});

test("every kind has the title COMPATIBILITY.md lists, in the comment and in the JSON", () => {
  const kinds = (read("src/verify.js").match(/kind: ((?:"\w+"(?: \| )?)+)/)?.[1] ?? "").match(/\w+/g) ?? [];
  assert.equal(kinds.length, 8);
  const row = tableAfter("**JSON**").find(([f]) => f === "`unverified`")?.[1] ?? "";
  for (const k of kinds) assert.ok(row.includes(`\`${k}\``), k);
  const comment = renderComment({ unverified: kinds.map((kind, i) => ({ kind: /** @type {any} */ (kind), said: "x", line: i + 1, detail: "d" })), checked: {}, notChecked: [] }, { subject: "pull request" });
  const titles = [...comment.matchAll(/^\| (\w+) \(line/gm)].map((m) => m[1]);
  const listed = DOC.match(/Each row names a kind: ([^.]+)\./)?.[1]?.split(/,\s+/) ?? [];
  assert.deepEqual(titles, listed);
});

test("the command line: options, exit codes and JSON fields as COMPATIBILITY.md says", (t) => {
  const repo = makeRepo(PROJECT);
  t.after(repo.cleanup);
  const help = cli(["--help"], repo.dir);
  assert.equal(help.status, 0);
  const usage = DOC.slice(DOC.indexOf("## The command line"));
  for (const o of new Set(help.stdout.match(/--[a-z]+/g))) assert.ok(usage.includes(o), o);
  assert.match(cli(["--version"], repo.dir).stdout.trim(), /^\d+\.\d+\.\d+$/);

  writeFileSync(join(repo.dir, "ok.md"), "See `src/widget/sync.py` and `sync_items()`.\n");
  writeFileSync(join(repo.dir, "bad.md"), "See `src/widget/tokens.py` and `refresh_token_cache()`.\n");
  assert.equal(cli(["ok.md"], repo.dir).status, 0);
  const bad = cli(["bad.md", "--json"], repo.dir);
  assert.equal(bad.status, 1);
  assert.equal(cli([], repo.dir).status, 2);
  assert.equal(cli(["missing.md"], repo.dir).status, 2);
  assert.equal(cli(["--nope"], repo.dir).status, 2);
  for (const code of ["0", "1", "2"]) assert.ok(usage.includes(`\`${code}\``), code);

  const json = JSON.parse(bad.stdout);
  const fields = tableAfter("**JSON**").map(([f]) => f?.replace(/`/g, ""));
  assert.deepEqual(Object.keys(json).sort(), [...fields].sort());
  assert.deepEqual(Object.keys(json.unverified[0]).sort(), ["detail", "kind", "line", "said"]);
  assert.deepEqual(json.unverified.map((/** @type {any} */ u) => u.kind), ["path", "symbol"]);
  const checked = tableAfter("**JSON**").find(([f]) => f === "`checked`")?.[1] ?? "";
  assert.deepEqual(Object.keys(json.checked).sort(), [...checked.matchAll(/`(\w+)`/g)].map((m) => m[1]).sort());
});

test("the limits both READMEs state are the code's", () => {
  const num = (/** @type {string} */ file, /** @type {RegExp} */ re) => Number(read(file).match(re)?.[1]);
  const source = num("src/repo.js", /MAX_SOURCE = (\d+) \* 1024 \* 1024/);
  const total = num("src/repo.js", /maxBytes \?\? (\d+) \* 1024 \* 1024/);
  const lookups = num("src/verify.js", /MAX_LOOKUPS = (\d+)/);
  // The loop right before the files request: pages of 100.
  const pages = num("src/github.js", /page <= (\d+); page\+\+\) \{\s*const r = await call\(`[^`]*\/pulls\/\$\{number\}\/files\?per_page=100/);
  assert.deepEqual([source, total, lookups, pages * 100], [16, 300, 30, 3000]);
  const en = read("README.md").replace(/\s+/g, " ");
  const zh = read("README.zh-CN.md").replace(/\s+/g, " ");
  for (const s of [`source files up to ${source} MB`, `${total} MB of text`, `first ${lookups} references and ${lookups} advisory ids`, "3,000 files"]) assert.ok(en.includes(s), s);
  for (const s of [`源文件最多 ${source} MB`, `文本最多 ${total} MB`, `${lookups} 个引用和 ${lookups} 个安全公告编号`, "3,000 个文件"]) assert.ok(zh.includes(s), s);
});
