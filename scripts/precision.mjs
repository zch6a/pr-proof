// Precision on real, merged pull requests (needs network and a GitHub token: GITHUB_TOKEN, or `gh auth token`).
//
//   node scripts/precision.mjs            check every pull request in scripts/corpus.json against its baseline
//   node scripts/precision.mjs --update   accept what is flagged now as the baseline
//   node scripts/precision.mjs --pick owner/repo[,owner/repo] [N]   add N recent merged pull requests per repository
//
// A merged pull request was reviewed and accepted, so nearly everything flagged on one is a false alarm; the few real
// catches (a description naming a file the pull request does not touch) are kept in the baseline, each with a note.
// Every repository is shallow-fetched at a pinned commit into the temp folder and only read: nothing in it is run.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { check } from "../src/check.js";
import { client } from "../src/github.js";
import { changesOf, indexRepo } from "../src/repo.js";

const CORPUS = new URL("./corpus.json", import.meta.url);
const cache = process.env.PR_PROOF_CORPUS || join(tmpdir(), "pr-proof-corpus");
const token = process.env.GITHUB_TOKEN || execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
const gh = client({ token });
/** @type {{repo: string, commit: string, prs: number[], expect: Record<string, string[]>, notes?: Record<string, string>}[]} */
const corpus = existsSync(CORPUS) ? JSON.parse(readFileSync(CORPUS, "utf8")) : [];

/** @param {string[]} args @param {string} [cwd] */
const git = (args, cwd) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "core.symlinks=false", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }).trim();

/** The repository at its pinned commit, fetched once into the cache. @param {string} repo @param {string} commit */
function checkout(repo, commit) {
  const dir = join(cache, repo.replace("/", "__"));
  if (!existsSync(join(dir, ".git"))) {
    mkdirSync(dir, { recursive: true });
    git(["init", "-q"], dir);
    git(["remote", "add", "origin", `https://github.com/${repo}.git`], dir);
  }
  let head = "";
  try { head = git(["rev-parse", "HEAD"], dir); } catch { /* empty */ }
  if (head !== commit) {
    git(["fetch", "-q", "--depth", "1", "origin", commit], dir);
    git(["checkout", "-q", "--force", "FETCH_HEAD"], dir);
  }
  return dir;
}

if (process.argv[2] === "--pick") {
  const per = Number(process.argv[4] ?? 25);
  for (const repo of (process.argv[3] ?? "").split(",").filter(Boolean)) {
    const [owner, name] = repo.split("/");
    const head = (await gh.call(`/repos/${owner}/${name}/commits?per_page=1`)).body[0].sha;
    const list = (await gh.call(`/repos/${owner}/${name}/pulls?state=closed&sort=updated&direction=desc&per_page=100`)).body;
    const prs = list.filter((/** @type {any} */ p) => p.merged_at && p.body && p.user?.type !== "Bot").slice(0, per).map((/** @type {any} */ p) => p.number);
    const at = corpus.findIndex((c) => c.repo === repo);
    const entry = { repo, commit: head, prs, expect: {} };
    if (at >= 0) corpus[at] = entry; else corpus.push(entry);
    console.log(`${repo}: ${prs.length} merged pull requests at ${head.slice(0, 7)}`);
  }
  writeFileSync(CORPUS, `${JSON.stringify(corpus, null, 2)}\n`);
  process.exit(0);
}

const update = process.argv.includes("--update");
let failed = false;
let total = 0;
let flaggedPrs = 0;
let items = 0;
const lookups = { ref: (/** @type {string} */ o, /** @type {string} */ r, /** @type {number} */ n) => gh.ref(o, r, n), advisory: (/** @type {string} */ id) => gh.advisory(id) };
for (const entry of corpus) {
  const [owner = "", name = ""] = entry.repo.split("/");
  const index = indexRepo(checkout(entry.repo, entry.commit));
  /** @type {Record<string, string[]>} */
  const got = {};
  for (const number of entry.prs) {
    const pr = (await gh.call(`/repos/${owner}/${name}/pulls/${number}`)).body;
    const files = await gh.pullFiles(owner, name, number);
    const { result } = await check({ text: `${pr.title}\n\n${pr.body ?? ""}`, index, changes: changesOf(files), owner, repo: name, isPull: true, lookups });
    total++;
    if (result.unverified.length) {
      flaggedPrs++;
      items += result.unverified.length;
      got[String(number)] = result.unverified.map((u) => `${u.kind}: ${u.said.slice(0, 80)}`);
    }
  }
  const keys = new Set([...Object.keys(got), ...Object.keys(entry.expect)]);
  const rows = [];
  for (const k of [...keys].sort((a, b) => Number(a) - Number(b))) {
    const now = got[k] ?? [];
    const before = entry.expect[k] ?? [];
    for (const x of now.filter((v) => !before.includes(v))) rows.push(`    + #${k} ${x}   (new: a false alarm?)`);
    for (const x of before.filter((v) => !now.includes(v))) rows.push(`    - #${k} ${x}   (gone)`);
  }
  console.log(`${entry.repo.padEnd(24)} ${String(entry.prs.length).padStart(3)} PRs  ${String(Object.keys(got).length).padStart(2)} flagged${rows.length ? "  ✗" : "  ✓"}`);
  for (const r of rows) console.log(r);
  if (update) entry.expect = got;
  else if (rows.length) failed = true;
}
console.log(`\n${total} merged pull requests, ${flaggedPrs} with something flagged, ${items} items.`);
if (update) {
  writeFileSync(CORPUS, `${JSON.stringify(corpus, null, 2)}\n`);
  console.log("baseline written to scripts/corpus.json");
} else if (failed) {
  console.log("\nDifferences from the baseline. Look at each one; if intended, run with --update.");
  process.exitCode = 1;
} else console.log("Matches the baseline.");
