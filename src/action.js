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
/** Inputs reach an Action as INPUT_<NAME> (upper case, spaces as underscores, hyphens kept). @param {string} name @param {string} fallback */
const input = (name, fallback) => (env[`INPUT_${name.replace(/ /g, "_").toUpperCase()}`] ?? "").trim() || fallback;
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
  const mode = input("mode", "comment");
  if (!["comment", "summary"].includes(mode)) throw new Error(`mode must be "comment" or "summary", not "${mode}"`);
  const label = input("label", "needs-evidence");
  // GITHUB_API_URL is set by GitHub (GitHub Enterprise has its own); PR_PROOF_CVE_API only for tests and mirrors.
  const gh = client({ token: input("github-token", env.GITHUB_TOKEN ?? ""), api: env.GITHUB_API_URL, cveApi: env.PR_PROOF_CVE_API });

  const index = indexRepo(workspace);
  const changes = isPull ? changesOf(await gh.pullFiles(owner, repo, subject.number)) : null;
  const { result, comment } = await check({
    text: `${subject.title ? `${subject.title}\n\n` : ""}${subject.body ?? ""}`,
    index, changes, owner, repo, isPull,
    lookups: { ref: (o, r, n) => gh.ref(o, r, n), advisory: (id) => gh.advisory(id) },
  });
  const count = result.unverified.length;
  output("unverified", String(count));
  summary(comment.replace(MARKER, "").trim());
  console.log(comment.replace(MARKER, "").trim());

  if (mode === "summary") return;
  const previous = await gh.findComment(owner, repo, subject.number, MARKER);
  if (count) {
    await gh.writeComment(owner, repo, subject.number, comment, previous?.id);
    if (label) await gh.setLabel(owner, repo, subject.number, label, true);
  } else if (previous) {
    // Fixed since the last run: say so in the same place, and take the label off.
    await gh.writeComment(owner, repo, subject.number, renderComment(result, { subject: isPull ? "pull request" : "issue", sha: index.sha }), previous.id);
    if (label) await gh.setLabel(owner, repo, subject.number, label, false);
  }
  if (count && input("fail-on-unverified", "false") === "true") process.exitCode = 1;
}

run().catch((e) => {
  console.log(`::error::pr-proof: ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
});
