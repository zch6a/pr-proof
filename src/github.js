// @ts-check
/**
 * The few GitHub (and CVE list) calls pr-proof makes, with the workflow's token: a pull request's changed files,
 * whether an issue or pull request exists, whether an advisory exists, and its own comment and label. Answers are
 * cached for the run; an error is "unknown", never "missing".
 */

/** @typedef {{token?: string, api?: string, cveApi?: string, fetch?: typeof fetch}} ClientOptions */

/** @param {ClientOptions} o */
export function client(o = {}) {
  const f = o.fetch ?? fetch;
  const api = (o.api ?? "https://api.github.com").replace(/\/$/, "");
  const cveApi = (o.cveApi ?? "https://cveawg.mitre.org/api").replace(/\/$/, "");
  const headers = {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "pr-proof",
    ...(o.token ? { authorization: `Bearer ${o.token}` } : {}),
  };
  /** @param {string} path @param {{method?: string, body?: unknown}} [init] */
  async function call(path, init = {}) {
    const res = await f(`${api}${path}`, {
      method: init.method ?? "GET",
      headers: { ...headers, ...(init.body !== undefined ? { "content-type": "application/json" } : {}) },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { status: res.status, body };
  }
  /** @type {Map<string, Promise<import("./verify.js").RefState>>} */
  const refs = new Map();
  /** @type {Map<string, Promise<boolean | null>>} */
  const advisories = new Map();
  /** @type {Map<string, Promise<boolean>>} */
  const repos = new Map();
  /** @param {string} owner @param {string} repo */
  const visible = (owner, repo) => {
    const key = `${owner}/${repo}`.toLowerCase();
    if (!repos.has(key)) repos.set(key, call(`/repos/${owner}/${repo}`).then((r) => r.status === 200, () => false));
    return /** @type {Promise<boolean>} */ (repos.get(key));
  };

  return {
    call,
    /** The files a pull request changes (the API lists up to 3,000). @param {string} owner @param {string} repo @param {number} number */
    async pullFiles(owner, repo, number) {
      /** @type {import("./repo.js").ChangedFile[]} */
      const all = [];
      for (let page = 1; page <= 30; page++) {
        const r = await call(`/repos/${owner}/${repo}/pulls/${number}/files?per_page=100&page=${page}`);
        if (r.status !== 200 || !Array.isArray(r.body)) throw new Error(`GitHub answered ${r.status} for the pull request's files`);
        all.push(...r.body);
        if (r.body.length < 100) break;
      }
      return all;
    },
    /** @param {string} owner @param {string} repo @param {number} number @returns {Promise<import("./verify.js").RefState>} */
    ref(owner, repo, number) {
      const key = `${owner}/${repo}#${number}`.toLowerCase();
      if (!refs.has(key)) {
        refs.set(key, call(`/repos/${owner}/${repo}/issues/${number}`).then(async (r) => {
          if (r.status === 200) return r.body && typeof r.body === "object" && "pull_request" in r.body ? "pull" : "issue";
          if (r.status === 410) return "issue"; // it existed and was deleted
          if (r.status !== 404) return "unknown";
          // 404: no such issue, or a repository the token cannot see. Only a repository it can see makes it "missing".
          const seen = await visible(owner, repo);
          return seen ? "missing" : "unknown";
        }, () => "unknown"));
      }
      return /** @type {Promise<import("./verify.js").RefState>} */ (refs.get(key));
    },
    /** Whether an advisory exists: CVE ids in the CVE list, GHSA ids in the GitHub Advisory Database. @param {string} id */
    advisory(id) {
      if (!advisories.has(id)) {
        const lookup = id.startsWith("CVE-")
          ? f(`${cveApi}/cve/${id}`, { headers: { accept: "application/json", "user-agent": "pr-proof" }, signal: AbortSignal.timeout(20_000) }).then((r) => (r.status === 200 ? true : r.status === 404 ? false : null))
          : call(`/advisories/${id}`).then((r) => (r.status === 200 ? true : r.status === 404 ? false : null));
        advisories.set(id, lookup.catch(() => null));
      }
      return /** @type {Promise<boolean | null>} */ (advisories.get(id));
    },
    /** pr-proof's earlier comment on an issue or pull request (by its marker), if any. @param {string} owner @param {string} repo @param {number} number @param {string} marker */
    async findComment(owner, repo, number, marker) {
      for (let page = 1; page <= 10; page++) {
        const r = await call(`/repos/${owner}/${repo}/issues/${number}/comments?per_page=100&page=${page}`);
        if (r.status !== 200 || !Array.isArray(r.body)) return null;
        const mine = r.body.find((c) => typeof c.body === "string" && c.body.startsWith(marker) && c.user?.type === "Bot");
        if (mine) return /** @type {{id: number, body: string}} */ (mine);
        if (r.body.length < 100) return null;
      }
      return null;
    },
    /** @param {string} owner @param {string} repo @param {number} number @param {string} body @param {number | undefined} existing */
    async writeComment(owner, repo, number, body, existing) {
      const r = existing
        ? await call(`/repos/${owner}/${repo}/issues/comments/${existing}`, { method: "PATCH", body: { body } })
        : await call(`/repos/${owner}/${repo}/issues/${number}/comments`, { method: "POST", body: { body } });
      if (r.status !== 200 && r.status !== 201) throw new Error(`GitHub answered ${r.status} when writing the comment (does the workflow have issues: write / pull-requests: write?)`);
    },
    /** @param {string} owner @param {string} repo @param {number} number @param {string} label @param {boolean} on */
    async setLabel(owner, repo, number, label, on) {
      const r = on
        ? await call(`/repos/${owner}/${repo}/issues/${number}/labels`, { method: "POST", body: { labels: [label] } })
        : await call(`/repos/${owner}/${repo}/issues/${number}/labels/${encodeURIComponent(label)}`, { method: "DELETE" });
      if (on && r.status !== 200) throw new Error(`GitHub answered ${r.status} when adding the label`);
    },
  };
}
