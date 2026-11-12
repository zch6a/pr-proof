// @ts-check
/**
 * What a repository has, for checking names against: its tracked files, the words in them (for function names) and
 * the long options they mention. Read only; nothing in the repository is run. Bounded: very large repositories are
 * indexed up to a limit, and the index says so (then a name that was not found is not reported: a missing word in a
 * partial index proves nothing).
 */
import { execFileSync } from "node:child_process";
import { closeSync, openSync, readSync, statSync } from "node:fs";
import { join } from "node:path";

/** @typedef {{files: Set<string>, names: Set<string>, words: Set<string>, options: Set<string>, complete: boolean, sha: string | null}} RepoIndex */

const WORD = /[A-Za-z_$][\w$]{2,}/g;
const OPTION = /--[a-zA-Z][a-zA-Z0-9]*(?:-[a-zA-Z0-9]+)*/g;
const MAX_FILE = 1024 * 1024;

/**
 * @param {string} dir a git checkout
 * @param {{maxBytes?: number}} [o]
 * @returns {RepoIndex}
 */
export function indexRepo(dir, o = {}) {
  const maxBytes = o.maxBytes ?? 300 * 1024 * 1024;
  // Only what git tracks: not build output, not node_modules, not the runner's own files.
  const out = execFileSync("git", ["-c", "core.quotepath=off", "ls-files", "-z"], { cwd: dir, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
  const files = new Set(out.split("\0").filter(Boolean));
  let sha = null;
  try { sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim(); } catch { /* no commit yet */ }
  const names = new Set([...files].map((f) => f.split("/").pop() ?? f));
  /** @type {Set<string>} */
  const words = new Set();
  /** @type {Set<string>} */
  const options = new Set();
  let total = 0;
  let complete = true;
  const buf = Buffer.alloc(MAX_FILE);
  for (const f of files) {
    let size;
    try { size = statSync(join(dir, f)).size; } catch { continue; } // tracked but deleted in the checkout
    if (size > MAX_FILE) continue; // bundles and data: not where a function is named
    if (total + size > maxBytes) { complete = false; break; }
    let n = 0;
    try {
      const fd = openSync(join(dir, f), "r");
      try { n = readSync(fd, buf, 0, size, 0); } finally { closeSync(fd); }
    } catch { continue; }
    total += n;
    const bytes = buf.subarray(0, n);
    if (bytes.includes(0)) continue; // binary
    const text = bytes.toString("utf8");
    for (const m of text.matchAll(WORD)) words.add(m[0]);
    for (const m of text.matchAll(OPTION)) options.add(m[0]);
  }
  return { files, names, words, options, complete, sha };
}

/** @typedef {{filename: string, status?: string, previous_filename?: string, patch?: string}} ChangedFile */
/** @typedef {{files: Set<string>, removed: Set<string>, words: Set<string>, options: Set<string>, patchesComplete: boolean}} Changes */

/**
 * A pull request's changes, as the GitHub API lists them: files added, changed, renamed or removed, and the words and
 * options on its added lines (a function the PR itself adds is not missing).
 * @param {ChangedFile[]} list
 * @returns {Changes}
 */
export function changesOf(list) {
  /** @type {Changes} */
  const c = { files: new Set(), removed: new Set(), words: new Set(), options: new Set(), patchesComplete: true };
  for (const f of list) {
    if (f.status === "removed") c.removed.add(f.filename);
    else c.files.add(f.filename);
    if (f.previous_filename) c.removed.add(f.previous_filename);
    // GitHub leaves out the patch of large or binary files: then their added names are unknown.
    if (f.patch === undefined && f.status !== "removed") c.patchesComplete = false;
    for (const line of (f.patch ?? "").split("\n")) {
      if (!line.startsWith("+") || line.startsWith("+++")) continue;
      for (const m of line.matchAll(WORD)) c.words.add(m[0]);
      for (const m of line.matchAll(OPTION)) c.options.add(m[0]);
    }
  }
  return c;
}

/**
 * Whether a path the text names is in the repository: exactly, or as the end of a tracked path (`utils.py` for
 * `src/utils.py`), or as a folder.
 * @param {RepoIndex} index @param {string} path @param {Changes | null} [changes]
 */
export function hasPath(index, path, changes) {
  const all = [index.files, changes?.files ?? new Set(), changes?.removed ?? new Set()];
  for (const set of all) {
    if (set.has(path)) return true;
    for (const f of set) if (f.endsWith(`/${path}`) || f.startsWith(`${path}/`) || f.includes(`/${path}/`)) return true;
  }
  return false;
}
