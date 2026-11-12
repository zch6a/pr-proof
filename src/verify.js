// @ts-check
/**
 * Checks what a pull request or issue says against the repository and, where a lookup is given, GitHub and the CVE
 * list. Each result is a fact with what was checked; nothing is a judgement of the contribution or of how it was
 * written.
 */
import { hasPath } from "./repo.js";

/** @typedef {import("./claims.js").Claims} Claims */
/** @typedef {import("./repo.js").RepoIndex} RepoIndex */
/** @typedef {import("./repo.js").Changes} Changes */
/** @typedef {"issue" | "pull" | "missing" | "unknown"} RefState */
/**
 * @typedef {{
 *   ref?: (owner: string, repo: string, number: number) => Promise<RefState>,
 *   advisory?: (id: string) => Promise<boolean | null>,
 * }} Lookups
 */
/** @typedef {{kind: "path" | "symbol" | "option" | "ref" | "fixes" | "advisory" | "tests" | "docs", said: string, line: number, detail: string}} Unverified */
/** @typedef {{unverified: Unverified[], checked: Record<string, number>, notChecked: string[]}} Result */

/** Changed files that are tests, and that are documentation. */
export const TEST_FILE = /(^|\/)(tests?|__tests__|spec|specs|testing|e2e)\/|[._-](test|spec|tests)\.[a-z0-9]+$|_test\.(go|py|rb|exs?)$|(^|\/)test_[^/]+\.py$|Tests?\.(java|kt|cs|swift)$/i;
export const DOC_FILE = /(^|\/)(docs?|documentation|website|site)\/|(^|\/)(readme|changelog|contributing)[^/]*$|\.(md|mdx|rst|adoc|txt)$/i;

/**
 * @param {Claims} claims
 * @param {RepoIndex} index the repository the text is about (for a pull request: its base)
 * @param {{changes?: Changes | null, owner: string, repo: string, lookups?: Lookups, isPull?: boolean}} context
 * @returns {Promise<Result>}
 */
export async function verify(claims, index, context) {
  const { changes = null, owner, repo, lookups = {}, isPull = false } = context;
  /** @type {Unverified[]} */
  const unverified = [];
  /** @type {Record<string, number>} */
  const checked = { paths: 0, symbols: 0, options: 0, refs: 0, advisories: 0, statements: 0 };
  /** @type {string[]} */
  const notChecked = [];
  const where = changes ? "in this repository or in this pull request's changes" : "in this repository";
  const at = index.sha ? ` (at ${index.sha.slice(0, 7)})` : "";

  for (const p of claims.paths) {
    checked.paths++;
    if (!hasPath(index, p.text, changes)) unverified.push({ kind: "path", said: p.text, line: p.line, detail: `No file or folder \`${p.text}\` ${where}${at}.` });
  }
  // A name not in a partial index (or in a PR whose large files have no patch) proves nothing: not reported.
  const namesComplete = index.complete && (!changes || changes.patchesComplete);
  if (!namesComplete && (claims.symbols.length || claims.options.length)) notChecked.push("function and option names (the repository or the changes were too large to index whole)");
  else {
    for (const s of claims.symbols) {
      checked.symbols++;
      if (!index.words.has(s.name) && !changes?.words.has(s.name)) unverified.push({ kind: "symbol", said: s.text, line: s.line, detail: `The name \`${s.name}\` appears nowhere ${where}${at}.` });
    }
    for (const o of claims.options) {
      checked.options++;
      if (!index.options.has(o.text) && !changes?.options.has(o.text)) unverified.push({ kind: "option", said: o.text, line: o.line, detail: `The option \`${o.text}\` appears nowhere ${where}${at}.` });
    }
  }

  if (lookups.ref) {
    for (const r of claims.refs) {
      const o = r.owner ?? owner;
      const n = r.repo ?? repo;
      const name = r.owner ? `${o}/${n}#${r.number}` : `#${r.number}`;
      checked.refs++;
      const state = await lookups.ref(o, n, r.number);
      if (state === "missing") unverified.push({ kind: "ref", said: r.text, line: r.line, detail: `There is no issue or pull request ${name}${r.owner ? "" : ` in ${owner}/${repo}`}.` });
      else if (state === "pull" && r.closing && isPull) unverified.push({ kind: "fixes", said: r.text, line: r.line, detail: `It says it fixes ${name}, which is a pull request, not an issue.` });
    }
  } else if (claims.refs.length) notChecked.push("issue references (no GitHub access)");

  if (lookups.advisory) {
    for (const a of claims.advisories) {
      checked.advisories++;
      const found = await lookups.advisory(a.text);
      if (found === false) unverified.push({ kind: "advisory", said: a.text, line: a.line, detail: a.text.startsWith("CVE") ? `There is no ${a.text} in the CVE list (cve.org).` : `There is no ${a.text} in the GitHub Advisory Database.` });
    }
  } else if (claims.advisories.length) notChecked.push("CVE and GHSA ids (no network access)");

  if (isPull && changes) {
    const changed = [...changes.files];
    if (claims.tests) {
      checked.statements++;
      if (!changed.some((f) => TEST_FILE.test(f))) unverified.push({ kind: "tests", said: claims.tests.text, line: claims.tests.line, detail: "It says it adds tests, but none of the changed files is a test file." });
    }
    if (claims.docs) {
      checked.statements++;
      if (!changed.some((f) => DOC_FILE.test(f))) unverified.push({ kind: "docs", said: claims.docs.text, line: claims.docs.line, detail: "It says it updates documentation, but none of the changed files is documentation." });
    }
  }
  unverified.sort((a, b) => a.line - b.line);
  return { unverified, checked, notChecked };
}
