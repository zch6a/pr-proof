// @ts-check
/**
 * The GitHub Action. On a pull request (pull_request or pull_request_target) or an issue (issues), it reads the text,
 * checks it against the checked-out repository (the base, for a pull request: nothing from the pull request is run
 * or checked out) and the pull request's changes from the API, and leaves one comment listing what it could not
 * verify, with a label. It edits that comment on later runs, and says when everything checks out.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { check } from "./check.js";
import { client } from "./github.js";
import { changesOf, indexRepo } from "./repo.js";
import { MARKER, renderComment } from "./report.js";

const env = process.env;
/**
 * Inputs reach an Action as INPUT_<NAME> (upper case, spaces as underscores, hyphens kept); GitHub sets the default
 * when an input is not given, so an empty value is what the workflow asked for (`label: ""` means no label).
 * @param {string} name @param {string} fallback
 */
const input = (name, fallback) => {
  const v = env[`INPUT_${name.replace(/ /g, "_").toUpperCase()}`];
  return v === undefined ? fallback : v.trim();
};
const MAINTAINERS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

/** @param {string} name @param {string} value */
function output(name, value) {
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `${name}=${value}\n`);
}
/** @param {string} text */
function summary(text) {
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${text}\n`);
}

export async function run() {
  const eventName = env.GITHUB_EVENT_NAME ?? "";
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH ?? "", "utf8"));
  const [owner = "", repo = ""] = (env.GITHUB_REPOSITORY ?? "").split("/");
  const isPull = eventName === "pull_request" || eventName === "pull_request_target";
  const subject = isPull ? event.pull_request : eventName === "issues" ? event.issue : null;
  if (!subject) return console.log(`pr-proof: nothing to check on a ${eventName} event (use pull_request_target, pull_request or issues).`);
  if (!isPull && subject.pull_request) return console.log("pr-proof: an issue event for a pull request; the pull request's own event checks it.");
  if (event.action && !["opened", "edited", "reopened", "synchronize", "ready_for_review"].includes(event.action)) return console.log(`pr-proof: nothing to do on "${event.action}".`);
  if (subject.user?.type === "Bot") return console.log("pr-proof: opened by a bot, not checked.");
  if (MAINTAINERS.has(subject.author_association) && input("check-maintainers", "false") !== "true") return console.log(`pr-proof: the author is a ${String(subject.author_association).toLowerCase()} of the repository, not checked (check-maintainers: true to check).`);

  const workspace = env.GITHUB_WORKSPACE ?? process.cwd();
  if (!existsSync(join(workspace, ".git"))) throw new Error("pr-proof needs the repository checked out: add `- uses: actions/checkout@v7` before it (for pull_request_target it checks out the base, which is what pr-proof should read).");
  let mode = input("mode", "comment") || "comment";
  if (!["comment", "summary"].includes(mode)) throw new Error(`mode must be "comment" or "summary", not "${mode}"`);
  // A pull_request event from a fork has a read-only token: comment and label would fail (and a red check would wrongly
  // blame the contributor). The job summary still has the result.
  const fork = isPull && eventName === "pull_request" && subject.head?.repo && subject.base?.repo && subject.head.repo.full_name !== subject.base.repo.full_name;
  if (fork && mode === "comment") {
    console.log("::notice::pr-proof: a pull_request event from a fork has a read-only token, so the result is in the job summary only. Use pull_request_target to comment.");
    mode = "summary";
  }
  const label = input("label", "needs-evidence");
  // GITHUB_API_URL is set by GitHub (GitHub Enterprise has its own); PR_PROOF_CVE_API only for tests and mirrors.
  const gh = client({ token: input("github-token", env.GITHUB_TOKEN ?? ""), api: env.GITHUB_API_URL, cveApi: env.PR_PROOF_CVE_API });

  const index = indexRepo(workspace);
  let changes = null;
  if (isPull) {
    try {
      changes = changesOf(await gh.pullFiles(owner, repo, subject.number));
    } catch (e) {
      // GitHub did not answer (an outage, a rate limit): nothing to check against, and nothing the contributor did.
      console.log(`::warning::pr-proof: could not read the pull request's files (${/** @type {Error} */ (e).message}); nothing was checked.`);
      summary(`pr-proof could not read the pull request's files (${/** @type {Error} */ (e).message}); nothing was checked.`);
      return;
    }
  }
  const { result, comment } = await check({
    title: subject.title ?? "",
    text: subject.body ?? "",
    index, changes, owner, repo, isPull,
    // Names in issues only when asked: in real issues they are mostly the reporter's own code or proposals.
    names: isPull || input("issue-names", "false") === "true",
    ignore: input("ignore", "").split(/[\n,]/),
    lookups: { ref: (o, r, n) => gh.ref(o, r, n), advisory: (id) => gh.advisory(id) },
  });
  const count = result.unverified.length;
  output("unverified", String(count));
  summary(comment.replace(MARKER, "").trim());
  console.log(comment.replace(MARKER, "").trim());

  if (mode === "summary") {
    if (count && input("fail-on-unverified", "false") === "true") process.exitCode = 1;
    return;
  }
  // The comment and the label are written independently: a locked conversation refuses the comment, not the label.
  // A failure here is the workflow's setup or GitHub's, never the contributor's: a warning, and the summary has it all.
  const warn = (/** @type {unknown} */ e) => {
    const flags = /** @type {{readOnly?: boolean, readFailed?: boolean}} */ (e);
    if (flags.readOnly || flags.readFailed) console.log(`::warning::pr-proof: ${/** @type {Error} */ (e).message}`);
    else throw e;
  };
  try {
    const previous = await gh.findComment(owner, repo, subject.number, MARKER);
    if (count) await gh.writeComment(owner, repo, subject.number, comment, previous?.id);
    // Fixed since the last run: say so in the same place.
    else if (previous) await gh.writeComment(owner, repo, subject.number, renderComment(result, { subject: isPull ? "pull request" : "issue", sha: index.sha }), previous.id);
  } catch (e) { warn(e); }
  try {
    // The label comes off whether or not the comment is still there.
    if (label) await gh.setLabel(owner, repo, subject.number, label, count > 0);
  } catch (e) { warn(e); }
  if (count && input("fail-on-unverified", "false") === "true") process.exitCode = 1;
}

run().catch((e) => {
  console.log(`::error::pr-proof: ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
});
