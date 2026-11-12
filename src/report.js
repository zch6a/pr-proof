// @ts-check
/**
 * The comment pr-proof leaves: what could not be verified, each with what was checked. It states facts and asks for
 * evidence; it does not say how the contribution was written, and it does not decide anything.
 */

/** Marks pr-proof's own comment, so a later run edits it instead of adding another. */
export const MARKER = "<!-- pr-proof -->";
/** GitHub refuses comments over 65,536 characters; rows past this many are summarised. */
const MAX_ROWS = 50;
const MAX_LENGTH = 60_000;

/**
 * Text from the contribution, shown as code: nothing in it can become a link, an image, a mention, HTML or a new table
 * cell. Backticks and backslashes are replaced (a backslash could otherwise undo the escaped pipe), and it is cut short.
 * @param {string} s
 */
export function quote(s) {
  let one = String(s).replace(/[\r\n]+/g, " ").replace(/`/g, "'").replace(/\\/g, "⧵").replace(/\|/g, "\\|");
  if (one.length > 100) one = `${one.slice(0, 99)}…`;
  return `\`${one.trim() || " "}\``;
}

/** Detail text has names from the contribution in backticks: those are made safe the same way. @param {string} s */
function safeDetail(s) {
  return s.replace(/`([^`]*)`/g, (_, inner) => quote(String(inner))).replace(/@(?=\w)/g, "@\u200B");
}

const KIND_TITLE = {
  path: "File", symbol: "Function", option: "Option", ref: "Reference", fixes: "Fixes", advisory: "Advisory", tests: "Tests", docs: "Docs",
};

/** "1 file, 3 functions and 2 options": what was checked, without the kinds that were not mentioned. @param {Record<string, number>} checked */
function countList(checked) {
  const words = /** @type {const} */ ([["paths", "file", "files"], ["symbols", "function", "functions"], ["options", "option", "options"], ["refs", "reference", "references"], ["advisories", "advisory", "advisories"], ["statements", "statement about tests or docs", "statements about tests or docs"]]);
  const parts = words.filter(([k]) => (checked[k] ?? 0) > 0).map(([k, one, many]) => `${checked[k]} ${checked[k] === 1 ? one : many}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0] ?? "";
}

/**
 * @param {import("./verify.js").Result} result
 * @param {{subject: "pull request" | "issue", sha?: string | null}} o
 */
export function renderComment(result, o) {
  const { unverified, checked, notChecked } = result;
  const total = Object.values(checked).reduce((a, b) => a + b, 0);
  const lines = [MARKER];
  if (!unverified.length) {
    lines.push(total
      ? `**pr-proof:** everything in this ${o.subject} that could be checked against the repository was found (${total} checked).`
      : `**pr-proof:** nothing in this ${o.subject} could be checked against the repository.`);
  } else {
    lines.push(`**pr-proof** could not verify ${unverified.length === 1 ? "one statement" : `${unverified.length} statements`} in this ${o.subject} against the repository:`, "");
    lines.push("| | Says | Checked |", "|---|---|---|");
    for (const u of unverified.slice(0, MAX_ROWS)) {
      const where = u.line === 0 ? "title" : `line ${u.line}`;
      lines.push(`| ${KIND_TITLE[u.kind]} (${where}) | ${quote(u.said)} | ${safeDetail(u.detail)} |`);
    }
    if (unverified.length > MAX_ROWS) lines.push("", `… and ${unverified.length - MAX_ROWS} more.`);
    lines.push("", "If these are right (a function from a dependency, an issue in another tracker), a link or a line of explanation is all that is needed. This is a check of facts, not a judgement of the contribution or of how it was written.");
  }
  if (notChecked.length) lines.push("", `Not checked: ${notChecked.join("; ")}.`);
  lines.push("", `<sub>Checked ${countList(checked) || "nothing it could check"}${o.sha ? ` against ${o.sha.slice(0, 7)}` : ""}. [pr-proof](https://github.com/zch6a/pr-proof) runs no AI and nothing from the ${o.subject}.</sub>`);
  const text = lines.join("\n");
  return text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH)}\n\n… (cut short)` : text;
}
