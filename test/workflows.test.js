// @ts-check
// The GitHub workflows, read as text: the token that can write is only where nothing of the project runs, every
// action is pinned to a commit, and the dogfood workflow runs the base branch's own code. Plus the release notes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { notes } from "../scripts/release-notes.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const workflow = (/** @type {string} */ name) => readFileSync(join(ROOT, ".github", "workflows", name), "utf8").replace(/\r\n/g, "\n");

/** @param {string} text */
function jobs(text) {
  const body = text.slice(text.indexOf("\njobs:\n") + 7);
  /** @type {Record<string, string>} */
  const out = {};
  for (const part of body.split(/\n(?=  [a-z][\w-]*:\n)/)) {
    const name = part.match(/^ {2}([a-z][\w-]*):/)?.[1];
    if (name) out[name] = part;
  }
  return out;
}

test("release: tests with a read-only token; the job that can write runs nothing of the project", () => {
  const text = workflow("release.yml");
  assert.match(text, /^permissions:\n {2}contents: read$/m);
  const { test: t, publish } = jobs(text);
  assert.ok(t && publish);
  assert.doesNotMatch(t, /contents: write/);
  assert.match(t, /persist-credentials: false/);
  assert.match(t, /npm test/);
  assert.match(publish, /contents: write/);
  assert.match(publish, /needs: test/);
  assert.doesNotMatch(publish, /checkout|npm |node /);
});

test("every action in every workflow is pinned to a commit (the local action excepted)", () => {
  for (const name of ["ci.yml", "release.yml", "pr-proof.yml"]) {
    for (const [, ref] of workflow(name).matchAll(/uses: ([^\s#]+)/g)) {
      if (ref === "./") continue;
      assert.match(String(ref), /@[0-9a-f]{40}$/, `${name}: ${ref}`);
    }
  }
});

test("the dogfood workflow: pull_request_target, the base checked out without credentials, the local action", () => {
  const text = workflow("pr-proof.yml");
  assert.match(text, /pull_request_target:/);
  assert.match(text, /persist-credentials: false/);
  assert.match(text, /uses: \.\//);
  assert.doesNotMatch(text, /ref: \$\{\{ github\.event\.pull_request\.head/, "never the pull request's head");
});

test("the release notes are the version's CHANGELOG section, which must exist before a tag", () => {
  const changelog = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8");
  const version = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
  const text = notes(changelog, version);
  assert.ok(text.length > 50);
  assert.doesNotMatch(text, /^## /m);
  assert.throws(() => notes(changelog, "99.0.0"), /no section for 99\.0\.0/);
});
