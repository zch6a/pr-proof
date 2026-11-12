#!/usr/bin/env node
// @ts-check
/**
 * pr-proof on the command line: check a pull request description or an issue text against a local checkout, before
 * posting it or while triaging. Offline: files, functions and options are checked; issue references and advisories
 * only with --github (then it asks the GitHub API and the CVE list).
 *
 *   pr-proof description.md                      against the repository in the current folder
 *   pr-proof description.md --base origin/main  as a pull request: the changes since main count, "adds tests" is checked
 *   pr-proof - --repo ../project --json          the text from stdin; JSON out
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { check } from "./check.js";
import { client } from "./github.js";
import { changesOf, indexRepo } from "./repo.js";
import { MARKER } from "./report.js";

const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const HELP = `pr-proof ${VERSION}: check what a pull request or issue says against the repository.

Usage:
  pr-proof <file | -> [--repo DIR] [--base REF] [--github OWNER/REPO] [--json]

  --repo DIR            the checkout to check against (default: the current folder)
  --base REF            read it as a pull request: what changed since REF counts, and "adds tests" is checked
  --github OWNER/REPO   also check issue references and CVE/GHSA ids (asks the GitHub API and the CVE list;
                        uses GITHUB_TOKEN if set)
  --json                the result as JSON

Exit code: 0 everything checked was found, 1 something could not be verified, 2 usage or other errors.`;

/** A local diff as the GitHub API lists changed files. @param {string} repo @param {string} base */
function localChanges(repo, base) {
  const diff = execFileSync("git", ["-c", "core.quotepath=off", "diff", "--no-color", "--find-renames", `${base}...HEAD`], { cwd: repo, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
  /** @type {import("./repo.js").ChangedFile[]} */
  const files = [];
  for (const part of diff.split(/^diff --git /m).slice(1)) {
    const head = part.split("\n", 1)[0] ?? "";
    const m = head.match(/^a\/(.+) b\/(.+)$/);
    if (!m) continue;
    const status = /^deleted file mode/m.test(part) ? "removed" : /^new file mode/m.test(part) ? "added" : /^rename from /m.test(part) ? "renamed" : "modified";
    const at = part.indexOf("\n@@");
    files.push({ filename: status === "removed" ? (m[1] ?? "") : (m[2] ?? ""), status, ...(status === "renamed" ? { previous_filename: m[1] } : {}), patch: at >= 0 ? part.slice(at + 1) : "" });
  }
  return files;
}

/** @param {string[]} argv */
export async function main(argv) {
  let args;
  try {
    args = parseArgs({ args: argv, allowPositionals: true, options: { repo: { type: "string" }, base: { type: "string" }, github: { type: "string" }, json: { type: "boolean" }, help: { type: "boolean", short: "h" }, version: { type: "boolean", short: "v" } } });
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : e}\n\n${HELP}\n`);
    return 2;
  }
  if (args.values.help) return process.stdout.write(`${HELP}\n`), 0;
  if (args.values.version) return process.stdout.write(`${VERSION}\n`), 0;
  const [file] = args.positionals;
  if (!file) return process.stderr.write(`${HELP}\n`), 2;
  try {
    const repo = resolve(args.values.repo ?? ".");
    const text = file === "-" ? readFileSync(0, "utf8") : readFileSync(file, "utf8");
    const base = args.values.base;
    const [owner = "", name = ""] = (args.values.github ?? "").split("/");
    if (args.values.github && (!owner || !name)) throw new Error("--github takes OWNER/REPO");
    const gh = args.values.github ? client({ token: process.env.GITHUB_TOKEN }) : null;
    const { claims, result, comment } = await check({
      text,
      index: indexRepo(repo),
      changes: base ? changesOf(localChanges(repo, base)) : null,
      owner, repo: name,
      isPull: !!base,
      lookups: gh ? { ref: (o, r, n) => gh.ref(o, r, n), advisory: (id) => gh.advisory(id) } : {},
    });
    process.stdout.write(args.values.json ? `${JSON.stringify({ version: VERSION, claims, ...result }, null, 2)}\n` : `${comment.replace(MARKER, "").trim()}\n`);
    return result.unverified.length ? 1 : 0;
  } catch (e) {
    process.stderr.write(`pr-proof: ${e instanceof Error ? e.message : e}\n`);
    return 2;
  }
}

process.exitCode = await main(process.argv.slice(2));
