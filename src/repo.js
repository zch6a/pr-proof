// @ts-check
/**
 * What a repository has, for checking names against: its tracked files and folders, the words in them (for function
 * and option names), its submodules and what it ignores. Read only; nothing in the repository is run. Bounded: the
 * index says when it could not read everything, and then a name that was not found is not reported (a missing word in
 * a partial index proves nothing).
 */
import { execFileSync } from "node:child_process";
import { closeSync, openSync, readSync, statSync } from "node:fs";
import { join } from "node:path";

import { EXT } from "./claims.js";

/**
 * @typedef {{
 *   files: Set<string>, folded: Map<string, string>, dirs: Set<string>, submodules: string[],
 *   words: Set<string>, kebab: Set<string>, options: Set<string>,
 *   complete: boolean, incompleteBecause: string[], sha: string | null,
 *   ignored: (path: string) => boolean,
 * }} RepoIndex
 */

const WORD = /[A-Za-z_$][\w$]{2,}/g;
// The lookbehind starts a match only at the start of a word: without it a long run of letters is tried from every
// position (quadratic: 28 s on a 256 KB line a contributor can put in a patch).
const KEBAB = /(?<![A-Za-z0-9-])[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+/g;
const OPTION = /--[a-zA-Z][a-zA-Z0-9]*(?:[-_][a-zA-Z0-9]+)*/g;
/** Text files up to this size are indexed; source files up to the larger one (an amalgamated C file can be 9 MB). */
const MAX_TEXT = 1024 * 1024;
const MAX_SOURCE = 16 * 1024 * 1024;

/** Case and Unicode form do not decide whether a path exists: `README.md` for `readme.md`, NFC for NFD. @param {string} p */
export const fold = (p) => p.normalize("NFC").toLowerCase();

/** UTF-8, or UTF-16 with a byte-order mark (PowerShell scripts often are); null for binary. @param {Buffer} bytes */
function decode(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString("utf16le");
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return Buffer.from(bytes.subarray(2)).swap16().toString("utf16le");
  if (bytes.includes(0)) return null;
  return bytes.toString("utf8");
}

/**
 * @param {string} dir a git checkout
 * @param {{maxBytes?: number}} [o]
 * @returns {RepoIndex}
 */
export function indexRepo(dir, o = {}) {
  const maxBytes = o.maxBytes ?? 300 * 1024 * 1024;
  const run = (/** @type {string[]} */ args) => execFileSync("git", ["-c", "core.quotepath=off", ...args], { cwd: dir, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
  // Only what git tracks (not build output, not dependencies); submodules are entries of mode 160000.
  /** @type {string[]} */
  const submodules = [];
  const files = new Set();
  for (const entry of run(["ls-files", "-s", "-z"]).split("\0").filter(Boolean)) {
    const tab = entry.indexOf("\t");
    const path = entry.slice(tab + 1);
    if (entry.startsWith("160000")) submodules.push(path);
    else files.add(path);
  }
  let sha = null;
  try { sha = run(["rev-parse", "HEAD"]).trim(); } catch { /* no commit yet */ }
  /** @type {Map<string, string>} */
  const folded = new Map();
  /** @type {Set<string>} */
  const dirs = new Set();
  for (const f of files) {
    folded.set(fold(f), f);
    const parts = f.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(fold(parts.slice(0, i).join("/")));
  }
  for (const s of submodules) dirs.add(fold(s));
  /** @type {Set<string>} */
  const words = new Set();
  /** @type {Set<string>} */
  const kebab = new Set();
  /** @type {Set<string>} */
  const options = new Set();
  /** @type {string[]} */
  const incompleteBecause = [];
  let total = 0;
  for (const f of files) {
    const source = EXT.test(f);
    let size;
    try { size = statSync(join(dir, f)).size; } catch {
      if (source) incompleteBecause.push(`${f} is tracked but not on disk`);
      continue;
    }
    if (size > (source ? MAX_SOURCE : MAX_TEXT)) {
      if (source) incompleteBecause.push(`${f} is larger than ${MAX_SOURCE / 1024 / 1024} MB`);
      continue; // data and bundles: not where a function is named
    }
    if (total + size > maxBytes) { incompleteBecause.push(`the repository has more than ${Math.round(maxBytes / 1024 / 1024)} MB of text`); break; }
    const buf = Buffer.alloc(size);
    try {
      const fd = openSync(join(dir, f), "r");
      try { readSync(fd, buf, 0, size, 0); } finally { closeSync(fd); }
    } catch { if (source) incompleteBecause.push(`${f} could not be read`); continue; }
    total += size;
    const text = decode(buf);
    if (text === null) continue; // binary
    for (const m of text.matchAll(WORD)) words.add(m[0]);
    for (const m of text.matchAll(KEBAB)) kebab.add(m[0].toLowerCase());
    for (const m of text.matchAll(OPTION)) options.add(m[0]);
  }
  /** @type {Map<string, boolean>} */
  const ignoredCache = new Map();
  const ignored = (/** @type {string} */ path) => {
    if (!ignoredCache.has(path)) {
      let hit = false;
      try { execFileSync("git", ["check-ignore", "--no-index", "-q", path], { cwd: dir, stdio: "ignore" }); hit = true; } catch { hit = false; }
      ignoredCache.set(path, hit);
    }
    return /** @type {boolean} */ (ignoredCache.get(path));
  };
  return { files, folded, dirs, submodules, words, kebab, options, complete: incompleteBecause.length === 0, incompleteBecause, sha, ignored };
}

/**
 * @typedef {{filename: string, status?: string, previous_filename?: string, patch?: string}} ChangedFile
 * @typedef {{files: Set<string>, removed: Set<string>, words: Set<string>, kebab: Set<string>, options: Set<string>, patchesComplete: boolean, testCode: boolean, docComments: boolean}} Changes
 */

/** Added lines that are tests whatever the file is called (Rust and Go keep unit tests next to the code). */
const TEST_CODE = /#\[[\w:]*(?:test|rstest|cfg\(test\))[\w:]*(?:\(|\])|^\+\s*(?:def test_|async def test_|func Test|@Test\b|@(?:Parameterized|Repeated)Test\b|\[(?:Fact|Theory|Test|TestMethod|TestCase)\b|TEST(?:_F|_P)?\(|(?:it|test|describe)\(\s*["'`]|assert\w*[\s(]|self\.assert\w+\(|expect\()/m;
/** Changed lines that are documentation in code: docstrings, doc comments, and lines inside them. */
// (A plain `# comment` or `// comment` is not documentation; a Go doc comment starts with the name it describes.)
const DOC_COMMENT = /^[+-]\s*(?:[rRuUbB]?"""|'''|\/\*\*|\*(?:\s|$)|\/\/\/|\/\/!|\/\/\s+[A-Z]\w*\s|#'|#\s*@\w+|@param|@return)/m;

/**
 * A pull request's changes, as the GitHub API lists them: files added, changed, renamed or removed, and the words and
 * options on its added lines (a function the PR itself adds is not missing).
 * @param {ChangedFile[]} list
 * @returns {Changes}
 */
export function changesOf(list) {
  /** @type {Changes} */
  const c = { files: new Set(), removed: new Set(), words: new Set(), kebab: new Set(), options: new Set(), patchesComplete: true, testCode: false, docComments: false };
  for (const f of list) {
    if (f.status === "removed") c.removed.add(f.filename);
    else c.files.add(f.filename);
    if (f.previous_filename) c.removed.add(f.previous_filename);
    // GitHub leaves out the patch of large or binary files: then their added names are unknown.
    if (f.patch === undefined && f.status !== "removed") c.patchesComplete = false;
    const patch = f.patch ?? "";
    if (TEST_CODE.test(patch)) c.testCode = true;
    if (DOC_COMMENT.test(patch)) c.docComments = true;
    for (const line of patch.split("\n")) {
      // Added lines, and removed ones: a pull request that removes `oldName()` says so.
      if (!/^[+-]/.test(line) || line.startsWith("+++") || line.startsWith("---")) continue;
      for (const m of line.matchAll(WORD)) c.words.add(m[0]);
      for (const m of line.matchAll(KEBAB)) c.kebab.add(m[0].toLowerCase());
      for (const m of line.matchAll(OPTION)) c.options.add(m[0]);
    }
  }
  return c;
}

/**
 * Whether a path the text names is in the repository or the pull request: exactly or ignoring case and Unicode form,
 * as the end of a tracked path (`utils/x.py` for `src/utils/x.py`), or as a folder.
 * @param {RepoIndex} index @param {string} path @param {Changes | null} [changes]
 */
export function hasPath(index, path, changes) {
  const p = fold(path);
  if (index.folded.has(p) || index.dirs.has(p)) return true;
  const others = [...(changes?.files ?? []), ...(changes?.removed ?? [])].map(fold);
  for (const f of [...index.folded.keys(), ...others]) {
    if (f === p || f.endsWith(`/${p}`) || f.startsWith(`${p}/`) || f.includes(`/${p}/`)) return true;
  }
  return false;
}

/**
 * Whether a path is plausibly about this repository: its first folder is a top-level folder of the repository or of
 * the pull request. `kube/config`, `cue-lang/vscode-cue` or `react-dom/client` are not; nor is `src/index.js` in a
 * monorepo whose `src` folders are inside packages (that is usually the reader's own project, as in a framework's
 * documentation). Those are left alone.
 * @param {RepoIndex} index @param {string} path @param {Changes | null} [changes]
 */
export function isRooted(index, path, changes) {
  const first = fold(path.split("/")[0] ?? "");
  if (!first) return false;
  if (index.dirs.has(first)) return true;
  return [...(changes?.files ?? []), ...(changes?.removed ?? [])].some((f) => fold(f).split("/").length > 1 && fold(f).split("/")[0] === first);
}

/** Under a submodule: its files are not in this repository's index, so the path cannot be checked. @param {RepoIndex} index @param {string} path */
export function inSubmodule(index, path) {
  const p = fold(path);
  return index.submodules.some((s) => p === fold(s) || p.startsWith(`${fold(s)}/`));
}

/** A frame from another machine (`/app/src/widget/sync.py`): the tracked file it ends with, if any. @param {RepoIndex} index @param {string} absolute */
export function trackedSuffix(index, absolute) {
  const parts = fold(absolute).split("/").filter(Boolean);
  for (let i = 0; i < parts.length - 1; i++) {
    const tail = parts.slice(i).join("/");
    if (index.folded.has(tail)) return index.folded.get(tail) ?? null;
  }
  return null;
}
