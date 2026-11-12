// @ts-check
/**
 * Checks what a pull request or issue says against the repository and, where a lookup is given, GitHub and the CVE
 * list. Each result is a fact with what was checked; nothing is a judgement of the contribution or of how it was
 * written. When an answer would not prove anything (a partial index, a lookup that failed, a path that is not about
 * this repository), the statement is left out or listed as not checked, never reported.
 */
import { hasPath, inSubmodule, isRooted, trackedSuffix } from "./repo.js";

/** @typedef {import("./claims.js").Claims} Claims */
/** @typedef {import("./repo.js").RepoIndex} RepoIndex */
/** @typedef {import("./repo.js").Changes} Changes */
/** @typedef {"issue" | "pull" | "discussion" | "missing" | "unknown"} RefState */
/**
 * @typedef {{
 *   ref?: (owner: string, repo: string, number: number) => Promise<RefState>,
 *   advisory?: (id: string, owner: string, repo: string) => Promise<boolean | null>,
 * }} Lookups
 */
/** @typedef {{kind: "path" | "symbol" | "option" | "ref" | "fixes" | "advisory" | "tests" | "docs", said: string, line: number, detail: string}} Unverified */
/** @typedef {{unverified: Unverified[], checked: Record<string, number>, notChecked: string[]}} Result */

/** Changed files that are tests, and that are documentation. */
export const TEST_FILE = /(^|\/)(tests?|__tests__|spec|specs|testing|e2e|testdata|fixtures|__snapshots__)\/|[._-](test|spec|tests|unittest)\.[a-z0-9]+$|_(test|unittest)\.(go|py|rb|exs?|cc|cpp|c)$|(^|\/)test_[^/]+\.py$|(Tests?|IT|Spec)\.(java|kt|cs|swift|php|scala|groovy)$|\.cy\.[jt]sx?$/i;
export const DOC_FILE = /(^|\/)(docs?|documentation|website|site|man|guides?|examples?)\/|(^|\/)(readme|changelog|contributing|history|news|authors)[^/]*$|\.(md|mdx|rst|adoc|txt|rd|rdoc|pod)$/i;

/** Lookups per check, at most: one text must not use up the token's API budget. */
const MAX_LOOKUPS = 30;

/** The other ways a codebase spells a name: snake_case, camelCase, without get/set/is (generated getters). @param {string} name */
function spellings(name) {
  const out = new Set([name]);
  const snake = name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  const camel = name.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
  out.add(snake);
  out.add(camel);
  out.add(camel.charAt(0).toUpperCase() + camel.slice(1));
  const bare = name.match(/^(?:get|set|is|has)_?([A-Za-z].*)$/)?.[1];
  if (bare) {
    out.add(bare.charAt(0).toLowerCase() + bare.slice(1));
    out.add(bare.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase());
  }
  return [...out];
}

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
    if (p.absolute) {
      // A frame from another machine: only its end can be this repository's file; if no tracked file ends like it,
      // it is a file of something else (the runtime, a dependency), not a claim about this repository.
      if (trackedSuffix(index, p.text)) checked.paths++;
      continue;
    }
    // Not about this repository (its first folder is not one of ours), in a submodule, or ignored (generated,
    // local): nothing to report either way.
    if (!isRooted(index, p.text, changes) || inSubmodule(index, p.text) || index.ignored(p.text)) continue;
    checked.paths++;
    if (!hasPath(index, p.text, changes)) unverified.push({ kind: "path", said: p.text, line: p.line, detail: `No file or folder \`${p.text}\` ${where}${at}.` });
  }

  // A name not in a partial index (or in a pull request whose large files have no patch) proves nothing.
  const namesComplete = index.complete && (!changes || changes.patchesComplete);
  if (!namesComplete && (claims.symbols.length || claims.options.length)) {
    notChecked.push(`function and option names (${index.incompleteBecause[0] ?? "a changed file has no patch: GitHub leaves out large and binary ones"})`);
  } else {
    const has = (/** @type {string} */ w) => index.words.has(w) || !!changes?.words.has(w);
    for (const s of claims.symbols) {
      checked.symbols++;
      if (!spellings(s.name).some(has)) unverified.push({ kind: "symbol", said: s.text, line: s.line, detail: `The name \`${s.name}\` appears nowhere ${where}${at}.` });
    }
    for (const o of claims.options) {
      checked.options++;
      // Frameworks name options without the dashes (`flag.Bool("dry-run")`, clap's `dry_run`), and add `--no-x` for `--x`.
      const bare = o.text.replace(/^--/, "");
      const base = bare.replace(/^no-/, "");
      const found = [o.text, `--${base}`].some((x) => index.options.has(x) || !!changes?.options.has(x))
        || [bare, base].some((x) => index.kebab.has(x.toLowerCase()) || !!changes?.kebab.has(x.toLowerCase()))
        || [bare, base].flatMap((x) => [x.replace(/-/g, "_"), ...spellings(x.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase()))]).some(has);
      if (!found) unverified.push({ kind: "option", said: o.text, line: o.line, detail: `The option \`${o.text}\` appears nowhere ${where}${at}.` });
    }
  }

  if (lookups.ref) {
    let lookedUp = 0;
    let unknown = 0;
    for (const r of claims.refs) {
      if (lookedUp >= MAX_LOOKUPS) { unknown++; continue; }
      const o = r.owner ?? owner;
      const n = r.repo ?? repo;
      const name = r.owner ? `${o}/${n}#${r.number}` : `#${r.number}`;
      lookedUp++;
      const state = await lookups.ref(o, n, r.number);
      if (state === "unknown") { unknown++; continue; }
      checked.refs++;
      if (state === "missing") unverified.push({ kind: "ref", said: r.text, line: r.line, detail: `There is no issue, pull request or discussion ${name}${r.owner ? "" : ` in ${owner}/${repo}`}.` });
      else if (state === "pull" && r.closing && isPull) unverified.push({ kind: "fixes", said: r.text, line: r.line, detail: `It says it fixes ${name}, which is a pull request, not an issue: closing keywords only close issues.` });
    }
    if (unknown) notChecked.push(`${unknown === 1 ? "one reference" : `${unknown} references`} (GitHub did not answer, or the repository is not visible to this workflow)`);
  } else if (claims.refs.length) notChecked.push("issue references (no GitHub access)");

  if (lookups.advisory) {
    let unknown = 0;
    for (const a of claims.advisories.slice(0, MAX_LOOKUPS)) {
      const found = await lookups.advisory(a.text, owner, repo);
      if (found === null) { unknown++; continue; }
      checked.advisories++;
      if (found === false) unverified.push({ kind: "advisory", said: a.text, line: a.line, detail: a.text.startsWith("CVE") ? `${a.text} is not in the CVE list (cve.org): a reserved id is not listed until it is published, so a link to where it is described helps.` : `${a.text} is in neither the GitHub Advisory Database nor this repository's advisories.` });
    }
    if (unknown) notChecked.push(`${unknown === 1 ? "one advisory id" : `${unknown} advisory ids`} (the lookup did not answer)`);
  } else if (claims.advisories.length) notChecked.push("CVE and GHSA ids (no network access)");

  if (isPull && changes) {
    const changed = [...changes.files];
    if (claims.tests) {
      checked.statements++;
      if (!changed.some((f) => TEST_FILE.test(f)) && !changes.testCode) unverified.push({ kind: "tests", said: claims.tests.text, line: claims.tests.line, detail: "It says it adds tests, but none of the changed files is a test file, and no added line is a test." });
    }
    if (claims.docs) {
      checked.statements++;
      if (!changed.some((f) => DOC_FILE.test(f)) && !changes.docComments) unverified.push({ kind: "docs", said: claims.docs.text, line: claims.docs.line, detail: "It says it updates the documentation, but none of the changed files is documentation, and no added line is a doc comment." });
    }
  }
  unverified.sort((a, b) => a.line - b.line);
  return { unverified, checked, notChecked };
}
