// @ts-check
// Throwaway git repositories in the temp folder, and a local stand-in for the GitHub API: no test touches a real
// repository or the network.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** Git with its configuration pointed away from the user's. @param {string} cwd @param {string[]} args */
export function git(cwd, args) {
  return execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", ...args], {
    cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", HOME: cwd, USERPROFILE: cwd, XDG_CONFIG_HOME: cwd },
  });
}

/** A repository with these files, committed. @param {Record<string, string>} files */
export function makeRepo(files) {
  const dir = mkdtempSync(join(tmpdir(), "pr-proof-test-"));
  git(dir, ["init", "-q"]);
  write(dir, files);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "initial"]);
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** @param {string} dir @param {Record<string, string>} files */
export function write(dir, files) {
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
}

/** A small project: a Python package with a CLI, tests and docs. */
export const PROJECT = {
  "README.md": "# widget\n\nRun `widget sync --dry-run` to preview.\n",
  "docs/usage.md": "Options: --dry-run, --verbose\n",
  "src/widget/__init__.py": "",
  "src/widget/sync.py": "def sync_items(items, dry_run=False):\n    return [i for i in items]\n\n\ndef parse_args(argv):\n    # --dry-run and --verbose\n    return argv\n",
  "src/widget/cache.py": "class Cache:\n    def evict(self, key):\n        pass\n",
  "tests/test_sync.py": "from widget.sync import sync_items\n\ndef test_sync():\n    assert sync_items([1]) == [1]\n",
};

/**
 * A stand-in for api.github.com: issues and pulls by number, a PR's files, and every request recorded.
 * @param {{issues?: Record<number, "issue" | "pull">, files?: object[], comments?: object[], advisories?: string[], cves?: string[]}} data
 */
export function fakeGithub(data) {
  /** @type {{method: string, url: string, body: any}[]} */
  const requests = [];
  const comments = /** @type {any[]} */ (data.comments ?? []);
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : null;
      const url = req.url ?? "";
      requests.push({ method: req.method ?? "", url, body });
      const send = (/** @type {number} */ status, /** @type {unknown} */ b) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(b));
      let m;
      if ((m = url.match(/^\/repos\/[^/]+\/[^/]+\/pulls\/\d+\/files/))) return send(200, url.includes("page=1") ? data.files ?? [] : []);
      if ((m = url.match(/^\/repos\/[^/]+\/[^/]+\/issues\/(\d+)\/comments/)) && req.method === "GET") return send(200, comments);
      if ((m = url.match(/^\/repos\/[^/]+\/[^/]+\/issues\/(\d+)\/comments/)) && req.method === "POST") {
        comments.push({ id: 900 + comments.length, body: body.body, user: { type: "Bot" } });
        return send(201, {});
      }
      if ((m = url.match(/^\/repos\/[^/]+\/[^/]+\/issues\/comments\/(\d+)/)) && req.method === "PATCH") {
        const c = comments.find((x) => x.id === Number(m?.[1]));
        if (c) c.body = body.body;
        return send(200, {});
      }
      if ((m = url.match(/^\/repos\/[^/]+\/[^/]+\/issues\/\d+\/labels/))) return send(req.method === "DELETE" ? 200 : 200, []);
      if ((m = url.match(/^\/repos\/[^/]+\/[^/]+\/issues\/(\d+)$/))) {
        const kind = data.issues?.[Number(m[1])];
        return kind ? send(200, kind === "pull" ? { number: Number(m[1]), pull_request: {} } : { number: Number(m[1]) }) : send(404, { message: "Not Found" });
      }
      if ((m = url.match(/^\/repos\/[^/]+\/[^/]+$/))) return send(200, {});
      if ((m = url.match(/^\/advisories\/(GHSA[\w-]+)$/))) return (data.advisories ?? []).includes(m[1] ?? "") ? send(200, {}) : send(404, {});
      if ((m = url.match(/^\/cve\/(CVE-[\d-]+)$/))) return (data.cves ?? []).includes(m[1] ?? "") ? send(200, {}) : send(404, {});
      send(404, { message: "Not Found" });
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = /** @type {{port: number}} */ (server.address()).port;
      resolve({ url: `http://127.0.0.1:${port}`, requests, comments, close: () => server.close() });
    });
  });
}
