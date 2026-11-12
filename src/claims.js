// @ts-check
/**
 * What a pull request or issue says that can be checked against the repository, read from its Markdown body.
 * Nothing here judges the text: it only lists statements that have a checkable answer.
 *
 * - paths:      files it names (`src/auth.py`, `lib/index.js:42`), in inline code or in stack traces in code blocks
 * - symbols:    functions it names in inline code (`refreshToken()`, `Cache.evict()`): the last name is what is looked for
 * - options:    command-line options it names in inline code (`--dry-run`)
 * - refs:       issues and pull requests it references (#12, owner/repo#12, links), and which ones it says it fixes
 * - advisories: CVE and GHSA ids
 * - tests/docs: sentences saying it adds tests or updates documentation
 */

/** @typedef {{text: string, line: number}} Mention */
/** @typedef {{owner?: string, repo?: string, number: number, closing: boolean, line: number, text: string}} Ref */
/** @typedef {{paths: Mention[], symbols: (Mention & {name: string})[], options: Mention[], refs: Ref[], advisories: Mention[], tests: Mention | null, docs: Mention | null}} Claims */

/** File extensions of source and text files: an inline-code word without a slash is a path only with one of these. */
const EXT = /\.(js|mjs|cjs|jsx|ts|mts|cts|tsx|py|pyi|rb|go|rs|java|kt|kts|scala|swift|c|cc|cpp|cxx|h|hh|hpp|cs|fs|php|pl|pm|lua|r|m|mm|dart|ex|exs|erl|hs|ml|clj|sh|bash|zsh|ps1|bat|cmd|sql|graphql|proto|vue|svelte|astro|html?|css|scss|sass|less|md|mdx|rst|txt|json|jsonc|ya?ml|toml|ini|cfg|conf|xml|gradle|cmake|mk|lock|env|dockerfile)$/i;
const NAMED_FILES = /^(Makefile|Dockerfile|Rakefile|Gemfile|Procfile|Justfile|CMakeLists\.txt|LICENSE|README(\.\w+)?|CHANGELOG(\.\w+)?|CONTRIBUTING(\.\w+)?|go\.mod|Cargo\.toml|package\.json|pyproject\.toml|setup\.py)$/;

/** Words in code spans that stand for something rather than name it. */
const PLACEHOLDER = /^(<.*>|\{.*\}|\$\{?\w+\}?|\.\.\.|…|foo|bar|baz|example|your[-_]\w+|my[-_]\w+|path\/to\/.*|some[-_]?\w*|xxx+)$/i;

/** A file path in inline code: relative, no spaces, not a URL, a glob or a home/absolute system path. @param {string} code */
export function asPath(code) {
  let s = code.trim().replace(/^\.\//, "");
  if (!s || /\s/.test(s) || /:\/\/|^[a-z][\w+.-]*:(?!\d)/i.test(s) || /[*?{}[\]<>|"'`$]/.test(s) || PLACEHOLDER.test(s)) return null;
  if (/^(~|\/(etc|usr|var|tmp|home|opt|proc|dev|bin|sbin|Users|Library|System)\/|[A-Za-z]:[\\/]|\.\.\/)/.test(s)) return null;
  s = s.replace(/^\//, "").replace(/\\/g, "/");
  // file.py:42, file.py:42:7, file.py#L42
  s = s.replace(/(:\d+){1,2}$|#L\d+(-L\d+)?$/, "");
  const folder = s.endsWith("/");
  s = s.replace(/\/+$/, "");
  const name = s.split("/").pop() ?? "";
  // A folder written as one (`src/widget/`): a path, whatever its last part looks like.
  if (folder && /^[\w.-]+(\/[\w.@-]+)*$/.test(s) && !/^\.+$/.test(name)) return /^(node_modules|\.git|vendor|site-packages)(\/|$)/.test(s) ? null : s;
  if (!name || name.startsWith("-")) return null;
  // A dotted module path (os.path.join) or a version (1.2.3) is not a file.
  if (!s.includes("/") && !EXT.test(name) && !NAMED_FILES.test(name)) return null;
  if (s.includes("/") && !EXT.test(name) && !NAMED_FILES.test(name) && !/^[\w.-]+(\/[\w.@-]+)+\/?$/.test(s)) return null;
  // Directory-like (src/utils/): a path too.
  if (/^\d+(\.\d+)+$/.test(name)) return null;
  if (/^(node_modules|\.git|vendor|site-packages)\//.test(s)) return null;
  return s;
}

/** A function in inline code: `name()`, `obj.name(x)`, `Mod::name()`; the name looked for is the last segment. @param {string} code */
export function asSymbol(code) {
  const m = code.trim().match(/^((?:[A-Za-z_$][\w$]*(?:\.|::|->|#))*)([A-Za-z_$][\w$]*)\s*\([^()]*\)$/);
  if (!m) return null;
  const name = m[2] ?? "";
  if (name.length < 3 || PLACEHOLDER.test(name)) return null;
  return name;
}

/** A long command-line option in inline code: `--dry-run`, `--max-size=10`. @param {string} code */
export function asOption(code) {
  const m = code.trim().match(/^(--[a-z][a-z0-9]*(?:-[a-z0-9]+)*)(?:[= ].*)?$/i);
  return m && m[1] ? m[1] : null;
}

const CLOSING = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+$/i;
const REF = /(?<![\w/#&])(?:([A-Za-z0-9][\w.-]*)\/([\w.-]+))?#(\d{1,7})\b/g;
const REF_URL = /https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(?:issues|pull)\/(\d+)\b/g;
const ADVISORY = /\b(CVE-\d{4}-\d{4,7}|GHSA(?:-[23456789cfghjmpqrvwx]{4}){3})\b/gi;
/** Stack-trace paths in code blocks: Python `File "x.py", line 3`, JS `at f (src/x.js:3:9)`, `src/x.go:12`. */
const TRACE_PATH = /File "([^"]+)", line \d+|\(([^()\s]+?\.\w+):\d+(?::\d+)?\)|(?:^|\s)([\w.-]+(?:\/[\w.@-]+)+\.\w+):\d+/g;

const NEGATED = /\b(no|not|without|n't|never|lack|missing|skip(?:ped|s)?|todo|will add|to be added|follow[- ]up|later)\b/i;
const TESTS = /\b(add(?:s|ed|ing)?|includ(?:e|es|ed|ing)|wr(?:ite|ote|itten|ites)|new|cover(?:s|ed)?\s+(?:by|with))\b[^.\n]{0,40}?\b(?:unit |integration |e2e |end-to-end |regression |snapshot )?tests?\b|\btests? (?:added|included|written)\b/i;
const DOCS = /\b(updat(?:e|es|ed|ing)|add(?:s|ed|ing)?|improv(?:e|es|ed|ing)|wr(?:ite|ote|ites)|document(?:s|ed|ing)?)\b[^.\n]{0,30}?\b(docs?|documentation|readme|changelog)\b/i;

/** Lines of Markdown, each marked as inside a fenced code block or not. @param {string} markdown */
function lines(markdown) {
  /** @type {{text: string, line: number, fenced: boolean}[]} */
  const out = [];
  let fence = "";
  markdown.replace(/\r\n?/g, "\n").split("\n").forEach((/** @type {string} */ text, /** @type {number} */ i) => {
    const f = text.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (f && f[1]) {
      if (!fence) { fence = f[1][0] ?? "`"; out.push({ text, line: i + 1, fenced: true }); return; }
      if (f[1][0] === fence) { fence = ""; out.push({ text, line: i + 1, fenced: true }); return; }
    }
    out.push({ text, line: i + 1, fenced: !!fence });
  });
  return out;
}

/** Drops HTML comments (PR templates leave their instructions in them), keeping the line count. @param {string} markdown */
function strip(markdown) {
  return markdown.replace(/<!--[\s\S]*?-->/g, (/** @type {string} */ m) => m.replace(/[^\n]/g, ""));
}

/** @param {string} markdown @returns {Claims} */
export function extractClaims(markdown) {
  /** @type {Claims} */
  const c = { paths: [], symbols: [], options: [], refs: [], advisories: [], tests: null, docs: null };
  const seen = new Set();
  const add = (/** @type {Mention[]} */ list, /** @type {Mention & Record<string, unknown>} */ m, /** @type {string} */ key) => {
    if (seen.has(key)) return;
    seen.add(key);
    list.push(m);
  };
  for (const { text, line, fenced } of lines(strip(markdown ?? ""))) {
    if (/^\s*>/.test(text)) continue; // a quote of someone else
    if (/^\s*[-*+]\s+\[ \]/.test(text)) continue; // an unticked template checkbox says nothing yet
    if (fenced) {
      for (const m of text.matchAll(TRACE_PATH)) {
        const p = asPath(m[1] ?? m[2] ?? m[3] ?? "");
        if (p) add(c.paths, { text: p, line }, `p:${p}`);
      }
      continue;
    }
    // Inline code spans.
    const prose = text.replace(/`([^`\n]+)`/g, (_, code) => {
      const p = asPath(code);
      const s = asSymbol(code);
      const o = asOption(code);
      if (p) add(c.paths, { text: p, line }, `p:${p}`);
      else if (s) add(c.symbols, { text: code.trim(), name: s, line }, `s:${s}`);
      else if (o) add(c.options, { text: o, line }, `o:${o}`);
      return " ".repeat(code.length + 2); // keep positions; code is not prose
    });
    for (const m of prose.matchAll(REF_URL)) {
      const number = Number(m[3]);
      const closing = CLOSING.test(prose.slice(0, m.index ?? 0));
      add(/** @type {any} */ (c.refs), { owner: m[1], repo: m[2], number, closing, line, text: m[0] }, `r:${m[1]}/${m[2]}#${number}:${closing}`);
    }
    const noUrls = prose.replace(REF_URL, (m) => " ".repeat(m.length)).replace(/https?:\/\/\S+/g, (m) => " ".repeat(m.length));
    for (const m of noUrls.matchAll(REF)) {
      const number = Number(m[3]);
      const closing = CLOSING.test(noUrls.slice(0, m.index ?? 0));
      const owner = m[1];
      const repo = m[2];
      add(/** @type {any} */ (c.refs), { ...(owner && repo ? { owner, repo } : {}), number, closing, line, text: m[0] }, `r:${owner ?? ""}/${repo ?? ""}#${number}:${closing}`);
    }
    for (const m of prose.matchAll(ADVISORY)) {
      const id = (m[1] ?? "").toUpperCase().replace(/^GHSA/, "GHSA").replace(/^(GHSA)(.*)$/, (_, g, rest) => g + rest.toLowerCase());
      add(c.advisories, { text: id, line }, `a:${id}`);
    }
    for (const [key, re] of /** @type {const} */ ([["tests", TESTS], ["docs", DOCS]])) {
      if (c[key]) continue;
      for (const sentence of prose.split(/(?<=[.!?;])\s+|\s+-\s+/)) {
        const hit = sentence.match(re);
        if (hit && !NEGATED.test(sentence.slice(0, (hit.index ?? 0) + hit[0].length)) && !/^\s*-?\s*\[ \]/.test(sentence)) {
          c[key] = { text: sentence.trim().slice(0, 120), line };
          break;
        }
      }
    }
  }
  return c;
}
