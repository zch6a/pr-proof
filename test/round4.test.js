// @ts-check
// Round 4: the maintainers' ignore list, for the false alarm that remains (a function only a dependency has).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { check } from "../src/check.js";
import { indexRepo } from "../src/repo.js";
import { ignoreList } from "../src/verify.js";
import { PROJECT, makeRepo } from "./helpers.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

test("ignore: names, whole calls, options, paths, with * as a wildcard; case does not matter", () => {
  const ignored = ignoreList(["recv_method_line", "h11.*", "--cov*", "vendor/*", " ", ""]);
  assert.ok(ignored("recv_method_line"));
  assert.ok(ignored("h11.Connection"), "a dependency's module");
  assert.ok(ignored("--cov-report"));
  assert.ok(ignored("vendor/lib/x.js"));
  assert.ok(ignored("RECV_METHOD_LINE"));
  assert.ok(!ignored("recv"), "a whole match, not a substring");
  assert.ok(!ignored("h11"), "h11.* needs the dot");
  assert.ok(!ignoreList([])("anything"), "an empty list ignores nothing");
  assert.ok(!ignoreList(["a.b"])("aXb"), "a dot is a dot, not any character");
});

test("an ignored name is not reported, counted or listed as not checked; others still are", async (t) => {
  const repo = makeRepo(PROJECT);
  t.after(repo.cleanup);
  const text = "Uses `h11.recv_method_line()`, `--cov-report`, `vendor/x/y.py` and `made_up_call()`.";
  const plain = (await check({ text, index: indexRepo(repo.dir), isPull: false })).result;
  assert.deepEqual(plain.unverified.map((u) => u.said), ["h11.recv_method_line()", "made_up_call()", "--cov-report"]);
  const r = (await check({ text, index: indexRepo(repo.dir), isPull: false, ignore: ["h11.*", "--cov*", "vendor/*"] })).result;
  assert.deepEqual(r.unverified.map((u) => u.said), ["made_up_call()"]);
  assert.equal(r.checked.symbols, 1);
  assert.equal(r.checked.options, 0);
});

test("the Action's ignore input and the command line's --ignore", async (t) => {
  const repo = makeRepo(PROJECT);
  t.after(repo.cleanup);
  const run = (/** @type {string[]} */ args, /** @type {string} */ input) => new Promise((resolve) => {
    const p = spawn(process.execPath, [join(ROOT, "src", "cli.js"), ...args], { cwd: repo.dir });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("close", (code) => resolve({ code, out }));
    p.stdin.end(input);
  });
  const a = /** @type {any} */ (await run(["-", "--ignore", "recv_*,--strict"], "`recv_method_line()` and `--strict`."));
  assert.equal(a.code, 0, a.out);
  // The Action reads INPUT_IGNORE split on new lines and commas (action.js); the same function does the matching.
  const lines = "h11.*\n--cov*, vendor/*".split(/[\n,]/);
  assert.ok(ignoreList(lines)("--cov-fail-under"));
});
