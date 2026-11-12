// @ts-check
/** One check, from a text to a result and a comment: what the Action and the command line share. */
import { extractClaims } from "./claims.js";
import { renderComment } from "./report.js";
import { verify } from "./verify.js";

/**
 * @param {{
 *   text: string,
 *   index: import("./repo.js").RepoIndex,
 *   changes?: import("./repo.js").Changes | null,
 *   owner?: string, repo?: string,
 *   lookups?: import("./verify.js").Lookups,
 *   isPull: boolean,
 * }} o
 */
export async function check(o) {
  const claims = extractClaims(o.text);
  const result = await verify(claims, o.index, { changes: o.changes ?? null, owner: o.owner ?? "", repo: o.repo ?? "", lookups: o.lookups, isPull: o.isPull });
  return { claims, result, comment: renderComment(result, { subject: o.isPull ? "pull request" : "issue", sha: o.index.sha }) };
}
