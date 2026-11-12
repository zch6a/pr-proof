// @ts-check
/** One check, from a text to a result and a comment: what the Action and the command line share. */
import { extractClaims } from "./claims.js";
import { renderComment } from "./report.js";
import { verify } from "./verify.js";

/**
 * @param {{
 *   text: string,
 *   title?: string,
 *   index: import("./repo.js").RepoIndex,
 *   changes?: import("./repo.js").Changes | null,
 *   owner?: string, repo?: string,
 *   lookups?: import("./verify.js").Lookups,
 *   isPull: boolean,
 *   names?: boolean,
 *   ignore?: string[],
 * }} o
 */
export async function check(o) {
  // The title is read on its own (its findings say "title"), so the body's line numbers are its own.
  const body = extractClaims(o.text);
  const claims = o.title ? merge(extractClaims(o.title, { lineOffset: 0 }), body) : body;
  const result = await verify(claims, o.index, { changes: o.changes ?? null, owner: o.owner ?? "", repo: o.repo ?? "", lookups: o.lookups, isPull: o.isPull, names: o.names ?? true, ignore: o.ignore ?? [] });
  return { claims, result, comment: renderComment(result, { subject: o.isPull ? "pull request" : "issue", sha: o.index.sha }) };
}

/** @param {import("./claims.js").Claims} a @param {import("./claims.js").Claims} b @returns {import("./claims.js").Claims} */
function merge(a, b) {
  // The same bound as one text (40 of each kind): title and body together, not 40 each.
  const uniq = (/** @type {any[]} */ xs, /** @type {(x: any) => string} */ key) => xs.filter((x, i) => xs.findIndex((y) => key(y) === key(x)) === i).slice(0, 40);
  return {
    paths: uniq([...a.paths, ...b.paths], (x) => x.text),
    symbols: uniq([...a.symbols, ...b.symbols], (x) => x.name),
    options: uniq([...a.options, ...b.options], (x) => x.text),
    refs: uniq([...a.refs, ...b.refs], (x) => `${x.owner ?? ""}/${x.repo ?? ""}#${x.number}:${x.closing}`),
    advisories: uniq([...a.advisories, ...b.advisories], (x) => x.text),
    tests: a.tests ?? b.tests,
    docs: a.docs ?? b.docs,
  };
}
