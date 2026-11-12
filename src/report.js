// @ts-check
/**
 * The comment pr-proof leaves: what could not be verified, each with what was checked. It states facts and asks for
 * evidence; it does not say how the contribution was written, and it does not decide anything.
 */

/** Marks pr-proof's own comment, so a later run edits it instead of adding another. */
export const MARKER = "<!-- pr-proof -->";

/** Text from the contribution, shown in a comment: no Markdown or HTML of its own, no mentions, and short. @param {string} s */
export function quote(s) {
  const one = String(s).replace(/[\r\n]+/g, " ").replace(/`/g, "'").replace(/</g, "&lt;").replace(/@(?=\w)/g, "@\u200B");
  return one.length > 100 ? `${one.slice(0, 99)}…` : one;
}

/** Detail text uses backticks around names from the contribution; those names are made safe the same way. @param {string} s */
function safeDetail(s) {
  return s.replace(/`([^`]*)`/g, (_, inner) => `\`${String(inner).replace(/`/g, "'").replace(/\n/g, " ").slice(0, 120)}\``).replace(/@(?=\w)/g, "@\u200B");
}

/** "1 file, 3 functions and 2 options": what was checked, without the kinds that were not mentioned. @param {Record<string, number>} checked */
function countList(checked) {
  const words = /** @type {const} */ ([["paths", "file", "files"], ["symbols", "function", "functions"], ["options", "option", "options"], ["refs", "reference", "references"], ["advisories", "advisory", "advisories"], ["statements", "statement about tests or docs", "statements about tests or docs"]]);
  const parts = words.filter(([k]) => (checked[k] ?? 0) > 0).map(([k, one, many]) => `${checked[k]} ${checked[k] === 1 ? one : many}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0] ?? "";
}

const KIND_TITLE = {
  path: "File", symbol: "Function", option: "Option", ref: "Reference", fixes: "Fixes", advisory: "Advisory", tests: "Tests", docs: "Docs",
};

/**
 * @param {import("./verify.js").Result} result
 * @param {{subject: "pull request" | "issue", sha?: string | null}} o
 */
export function renderComment(result, o) {
  const { unverified, checked, notChecked } = result;
  const total = Object.values(checked).reduce((a, b) => a + b, 0);
  const lines = [MARKER];
  if (!unverified.length) {
    lines.push(`**pr-proof:** everything in this ${o.subject} that could be checked against the repository was found (${total} checked).`);
  } else {
    lines.push(`**pr-proof** could not verify ${unverified.length === 1 ? "one statement" : `${unverified.length} statements`} in this ${o.subject} against the repository:`, "");
    lines.push("| | Says | Checked |", "|---|---|---|");
    for (const u of unverified) lines.push(`| ${KIND_TITLE[u.kind]} (line ${u.line}) | ${quote(u.said).replace(/\|/g, "\\|")} | ${safeDetail(u.detail).replace(/\|/g, "\\|")} |`);
    lines.push("", "If these are right (a function from a dependency, an issue in another tracker), a link or a line of explanation is all that is needed. This is a check of facts, not a judgement of the contribution or of how it was written.");
  }
  if (notChecked.length) lines.push("", `Not checked: ${notChecked.join("; ")}.`);
  lines.push("", `<sub>Checked ${countList(checked) || "nothing it could check"}${o.sha ? ` against ${o.sha.slice(0, 7)}` : ""}. [pr-proof](https://github.com/zch6a/pr-proof) runs no AI and nothing from the ${o.subject}.</sub>`);
  return lines.join("\n");
}
