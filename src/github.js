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
  /** @type {Map<string, Promise<{has_discussions?: boolean} | null>>} */
  const repos = new Map();
  /** The repository, if this token can see it. @param {string} owner @param {string} repo */
  const visible = (owner, repo) => {
    const key = `${owner}/${repo}`.toLowerCase();
    if (!repos.has(key)) repos.set(key, call(`/repos/${owner}/${repo}`).then((r) => (r.status === 200 && r.body && typeof r.body === "object" ? r.body : null), () => null));
    return /** @type {Promise<{has_discussions?: boolean} | null>} */ (repos.get(key));
  };
  // GraphQL sits next to the REST API: api.github.com/graphql, or <host>/api/graphql on GitHub Enterprise.
  const graphqlPath = /\/api\/v3$/.test(api) ? api.replace(/\/v3$/, "/graphql") : `${api}/graphql`;
  /** Whether a discussion exists (the REST API has none for repositories). @param {string} owner @param {string} repo @param {number} number */
  async function discussion(owner, repo, number) {
    const res = await f(graphqlPath, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ query: "query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){discussion(number:$n){number}}}", variables: { o: owner, r: repo, n: number } }),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status !== 200) return null;
    const body = /** @type {{data?: {repository?: {discussion?: unknown}}, errors?: {type?: string}[]}} */ (await res.json());
    if (body.data?.repository?.discussion) return true;
    if (body.errors?.some((e) => e.type === "NOT_FOUND") || body.data?.repository) return false;
    return null;
  }
  /** @type {Promise<string | null> | null} */
  let self = null;
  /** The login of the token's own user (a personal token); null for the workflow's token, whose comments are a bot's. */
  const login = () => (self ??= call("/user").then((r) => (r.status === 200 && r.body && typeof r.body === "object" && "login" in r.body ? String(r.body.login) : null), () => null));

  return {
    call,
    /** The files a pull request changes (the API lists up to 3,000). @param {string} owner @param {string} repo @param {number} number */
    async pullFiles(owner, repo, number) {
      /** @type {import("./repo.js").ChangedFile[]} */
      const all = [];
      for (let page = 1; page <= 30; page++) {
        const r = await call(`/repos/${owner}/${repo}/pulls/${number}/files?per_page=100&page=${page}`);
        if (r.status !== 200 || !Array.isArray(r.body)) throw Object.assign(new Error(`GitHub answered ${r.status} for the pull request's files`), { readFailed: true });
        all.push(...r.body);
        if (r.body.length < 100) return all;
      }
      // The API lists at most 3,000 files: past that, the changes are not whole (a file with no patch says so).
      all.push({ filename: "(more files than the API lists)", status: "modified" });
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
          // 404: no such issue, a repository the token cannot see, or a discussion (which has numbers of the same
          // series). Only a visible repository without such a discussion makes it "missing".
          const seen = await visible(owner, repo);
          if (!seen) return "unknown";
          if (seen.has_discussions) {
            const d = await discussion(owner, repo, number).catch(() => null);
            return d === true ? "discussion" : d === false ? "missing" : "unknown";
          }
          return "missing";
        }, () => "unknown"));
      }
      return /** @type {Promise<import("./verify.js").RefState>} */ (refs.get(key));
    },
    /**
     * Whether an advisory exists: CVE ids in the CVE list; GHSA ids in the GitHub Advisory Database or among the
     * repository's own advisories. On GitHub Enterprise the global database may be missing: then unknown, not missing.
     * @param {string} id @param {string} [owner] @param {string} [repo]
     */
    advisory(id, owner, repo) {
      if (!advisories.has(id)) {
        const dotcom = api === "https://api.github.com";
        const lookup = id.startsWith("CVE-")
          ? f(`${cveApi}/cve/${id}`, { headers: { accept: "application/json", "user-agent": "pr-proof" }, signal: AbortSignal.timeout(20_000) }).then((r) => (r.status === 200 ? true : r.status === 404 ? false : null))
          : call(`/advisories/${id}`).then(async (r) => {
            if (r.status === 200) return true;
            if (r.status !== 404) return null;
            if (owner && repo) {
              const own = await call(`/repos/${owner}/${repo}/security-advisories/${id}`);
              if (own.status === 200) return true;
            }
            return dotcom ? false : null;
          });
        advisories.set(id, lookup.catch(() => null));
      }
      return /** @type {Promise<boolean | null>} */ (advisories.get(id));
    },
    /** pr-proof's earlier comment on an issue or pull request (by its marker), if any. @param {string} owner @param {string} repo @param {number} number @param {string} marker */
    async findComment(owner, repo, number, marker) {
      for (let page = 1; page <= 10; page++) {
        const r = await call(`/repos/${owner}/${repo}/issues/${number}/comments?per_page=100&page=${page}`);
        // Not knowing whether there is a comment is not "there is none": that would post a second one.
        if (r.status !== 200 || !Array.isArray(r.body)) throw Object.assign(new Error(`GitHub answered ${r.status} for the comments`), { readFailed: true });
        const me = await login();
        const mine = r.body.find((c) => typeof c.body === "string" && c.body.startsWith(marker) && (c.user?.type === "Bot" || (me !== null && c.user?.login === me)));
        if (mine) return /** @type {{id: number, body: string}} */ (mine);
        if (r.body.length < 100) return null;
      }
      return null;
    },
    /** @param {string} owner @param {string} repo @param {number} number @param {string} body @param {number | undefined} existing */
    async writeComment(owner, repo, number, body, existing) {
      let r = existing ? await call(`/repos/${owner}/${repo}/issues/comments/${existing}`, { method: "PATCH", body: { body } }) : null;
      // Deleted since it was found: write a new one.
      if (!r || r.status === 404) r = await call(`/repos/${owner}/${repo}/issues/${number}/comments`, { method: "POST", body: { body } });
      if (r.status === 403 || r.status === 401) throw Object.assign(new Error(`GitHub answered ${r.status} when writing the comment: the conversation is locked, or the token cannot write here (a pull_request event from a fork has a read-only token; use pull_request_target, and give the job issues: write and pull-requests: write)`), { readOnly: true });
      if (r.status !== 200 && r.status !== 201) throw new Error(`GitHub answered ${r.status} when writing the comment`);
    },
    /** @param {string} owner @param {string} repo @param {number} number @param {string} label @param {boolean} on */
    async setLabel(owner, repo, number, label, on) {
      const r = on
        ? await call(`/repos/${owner}/${repo}/issues/${number}/labels`, { method: "POST", body: { labels: [label] } })
        : await call(`/repos/${owner}/${repo}/issues/${number}/labels/${encodeURIComponent(label)}`, { method: "DELETE" });
      if (on && (r.status === 403 || r.status === 401)) throw Object.assign(new Error(`GitHub answered ${r.status} when adding the label: the token cannot write here`), { readOnly: true });
      if (on && r.status !== 200) throw new Error(`GitHub answered ${r.status} when adding the label`);
    },
  };
}
