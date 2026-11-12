// @ts-check
/**
 * What a pull request or issue says that can be checked against the repository, read from its Markdown body.
 * Nothing here judges the text: it only lists statements that have a checkable answer. Precision comes first: a
 * contributor told that something true "could not be verified" is wronged, so anything that may not be a statement
 * about this repository is left out (verify.js then also skips paths whose first folder the repository does not have).
 *
 * - paths:      files and folders it names in inline code (`src/auth.py`, `lib/x.js:42`, `docs/`), and frames of stack
 *               traces in code blocks (Python, JavaScript, Go); `absolute` for frames from another machine (`/app/src/x.py`)
 * - symbols:    functions it names in inline code (`refreshToken()`, `Cache.evict()`): the last name is looked for
 * - options:    long command-line options in inline code (`--dry-run`)
 * - refs:       issues and pull requests it references (#12, owner/repo#12, links), and which ones it says it fixes
 * - advisories: CVE and GHSA ids
 * - tests/docs: a sentence saying it adds tests or updates the documentation (statements, not questions or plans)
 */

/** @typedef {{text: string, line: number}} Mention */
/** @typedef {Mention & {absolute?: boolean, frame?: boolean}} PathMention */
/** @typedef {{owner?: string, repo?: string, number: number, closing: boolean, line: number, text: string}} Ref */
/** @typedef {{paths: PathMention[], symbols: (Mention & {name: string})[], options: Mention[], refs: Ref[], advisories: Mention[], tests: Mention | null, docs: Mention | null}} Claims */

/** File extensions of source and text files. */
export const EXT = /\.(js|mjs|cjs|jsx|ts|mts|cts|tsx|py|pyi|rb|go|rs|java|kt|kts|scala|swift|c|cc|cpp|cxx|h|hh|hpp|cs|fs|php|pl|pm|lua|r|m|mm|dart|ex|exs|erl|hs|ml|clj|sh|bash|zsh|ps1|bat|cmd|sql|graphql|proto|vue|svelte|astro|html?|css|scss|sass|less|md|mdx|rst|txt|json|jsonc|ya?ml|toml|ini|cfg|conf|xml|gradle|cmake|mk|lock|dockerfile|ejs|hbs|tmpl|tpl)$/i;
const NAMED_FILES = /^(Makefile|Dockerfile|Rakefile|Gemfile|Procfile|Justfile|CMakeLists\.txt|LICENSE|README(\.\w+)?|CHANGELOG(\.\w+)?|CONTRIBUTING(\.\w+)?|go\.mod|go\.sum|Cargo\.toml|package\.json|pyproject\.toml|setup\.py)$/;
/** Library and site names that look like file names (`Node.js`, `Chart.js`, `docs.rs`). */
const NOT_A_FILE = /^([A-Z][\w-]*\.js|[\w-]+\.(rs|sh|io|dev|app|ai|so|to|me|cc|co|gg|ly|org|net|com))$/;

/** Words in code spans that stand for something rather than name it. */
const PLACEHOLDER = /^(<.*>|\{.*\}|\$\{?\w+\}?|\.\.\.|…|foo|bar|baz|qux|example|your[-_]\w+|my[-_]\w+|path\/to\/.*|some[-_]?\w*|xxx+)$/i;
/** Folders of dependencies and environments: never the repository's own files. */
const FOREIGN = /(^|\/)(node_modules|site-packages|dist-packages|\.venv|venv|env|vendor|\.git|\.cargo|go\/pkg\/mod|bower_components|\.m2|\.gradle)(\/|$)/;

/**
 * A file or folder path in inline code: relative, no spaces, not a URL, a glob, a placeholder or a system path, and
 * with a directory: a bare name (`sample.txt`, `express.json`) is too often the reader's own file, a library or a
 * function written without its parentheses to count as a statement about this repository.
 * @param {string} code
 */
export function asPath(code) {
  let s = code.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!s || /\s/.test(s) || /:\/\/|^[a-z][\w+.-]*:(?!\d)/i.test(s) || /[*?{}[\]<>|"'`$@]/.test(s) || PLACEHOLDER.test(s)) return null;
  if (/^(~|\/|[A-Za-z]:\/|\.\.\/)/.test(s)) return null; // home, absolute and outside paths: not the repository
  s = s.replace(/(:\d+){1,2}$|#L\d+(-L\d+)?$/, ""); // file.py:42, file.py:42:7, file.py#L42
  const folder = s.endsWith("/");
  s = s.replace(/\/+$/, "");
  if (!s.includes("/") || FOREIGN.test(s)) return null;
  const name = s.split("/").pop() ?? "";
  if (!name || /^\.+$/.test(name) || name.startsWith("-")) return null;
  if (/\\[ntr0]/.test(code)) return null; // an escaped string (`alpha\nbeta`), not a Windows path
  if (!/^[\w.-]+(\/[\w.@+-]+)+$/.test(s)) return null;
  // A folder only when written as one; a file only with a known extension or name.
  if (folder) return s;
  if (!EXT.test(name) && !NAMED_FILES.test(name)) return null;
  if (/^\d+(\.\d+)+$/.test(name) || NOT_A_FILE.test(name)) return null;
  return s;
}

/** Calls on standard libraries and well-known globals: not the repository's functions. */
const STDLIB = /^(JSON|Math|Object|Array|Promise|Number|String|Date|Reflect|console|window|document|navigator|process|Buffer|URL|crypto|fs|path|os|sys|re|json|math|time|datetime|subprocess|shutil|itertools|functools|collections|typing|asyncio|std|core|alloc|fmt|strings|strconv|errors|io|ioutil|bytes|sort|http|net|filepath|reflect|context|sync|log|java|javax|System|Integer|Collections|Arrays|Objects|Optional|torch|np|numpy|pd|pandas)$/;

/** A function in inline code: `name()`, `obj.name(x)`, `Mod::name()`; the name looked for is the last segment. @param {string} code */
export function asSymbol(code) {
  const m = code.trim().match(/^((?:[A-Za-z_$][\w$]*(?:\.|::|->|#))*)([A-Za-z_$][\w$]*)\s*\([^()]*\)$/);
  if (!m) return null;
  const name = m[2] ?? "";
  const first = (m[1] ?? "").split(/\.|::|->|#/)[0] ?? "";
  if (name.length < 3 || PLACEHOLDER.test(name) || (first && STDLIB.test(first))) return null;
  return name;
}

/** Options every command-line framework adds by itself. */
const BUILTIN_OPTIONS = new Set(["--help", "--version", "--verbose", "--quiet", "--debug"]);

/** A long command-line option in inline code: `--dry-run`, `--max-size=10`. @param {string} code */
export function asOption(code) {
  const m = code.trim().match(/^(--[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*)(?:[= ].*)?$/i);
  const o = m?.[1];
  return o && !BUILTIN_OPTIONS.has(o.toLowerCase()) ? o : null;
}

const CLOSING = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+$/i;
const REF = /(?<![\w/#&])(?:([A-Za-z0-9][\w.-]*)\/([\w.-]+))?#(\d{1,7})\b/g;
const REF_URL = /https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(?:issues|pull|discussions)\/(\d+)\b/g;
/** Words before a number that make it an ordinal or a label, not an issue: "step #1", "item #2", "the #1 cause". */
const NOT_A_REF_BEFORE = /\b(step|item|number|no\.?|rank(?:ed)?|top|phase|point|part|round|level|line|row|attempt|try|case|example|option|choice|place|position|version|v|page|slide|figure|fig\.?|table|chapter|section|question|q|task|day|week|episode|track|build|run|job|commit)\s*$/i;
/** A line about colours: `#333` there is a colour, not issue 333. */
const COLOUR_CONTEXT = /\b(colou?rs?|background|foreground|fill|stroke|border|hex|rgba?|hsl|css|theme|palette|shade)\b/i;
const ADVISORY = /\b(CVE-\d{4}-\d{4,7}|GHSA(?:-[23456789cfghjmpqrvwx]{4}){3})\b/gi;
/** Stack-trace frames in code blocks: Python `File "x.py", line 3`, JS `at f (src/x.js:3:9)` and `at src/x.js:3:9`, Go `\tsrc/x.go:12`. */
const TRACE_PATH = /File "([^"]+)", line \d+|\(([^()\s]+?\.\w+):\d+(?::\d+)?\)|\bat (\/?[\w.@-]+(?:\/[\w.@+-]+)+\.\w+):\d+|^\s+(\/?[\w.@-]+(?:\/[\w.@+-]+)+\.go):\d+/g;

/** A frame's path: relative ones are read like inline paths; absolute ones (another machine) are kept to be matched by their end. @param {string} raw */
function framePath(raw) {
  const s = raw.replace(/\\/g, "/").replace(/^[A-Za-z]:/, "");
  if (FOREIGN.test(s) || !s.includes("/") || !EXT.test(s)) return null;
  if (s.startsWith("/")) return { text: s, absolute: true };
  if (/^\.\.\//.test(s) || /^</.test(s)) return null;
  const p = asPath(s);
  return p ? { text: p } : null;
}

// Statements: a negation anywhere before the claim; questions, offers and plans; test results; template text.
const NEGATED = /\b(no|not|without|never|lack(?:s|ing)?|missing|skip(?:ped|s)?|todo|cannot|unable|nor)\b|n['’]t\b/i;
const NOT_A_STATEMENT = /\?\s*$|\b(if|please|should|could|would|might|may|need to|needs to|happy to|feel free|plan(?:s|ning)? to|going to|want to|wants to|let me know|follow[- ]?up|later|eventually|to be added|will|shall)\b|['’]ll\b/i;
const TEST_RESULT = /\b\d+\s+(?:passed|passing|failed|failing|skipped|ignored|tests?|specs?|cases?)\b|\b(?:passed|passes|passing|green|succeed(?:s|ed)?)\b/i;
const TESTS = /\b(add(?:s|ed|ing)?|includ(?:e|es|ed)|wr(?:ite|ote|itten|ites)|new|extend(?:s|ed)?|cover(?:s|ed)?\s+(?:by|with))\b(?:(?!\d|\b(?:runs?|running|ran|execut\w*|trigger\w*|invok\w*)\b)[^.\n]){0,40}?\b(?:unit |integration |e2e |end-to-end |regression |snapshot |more |some |a few |new )?tests?\b(?!\s*(?:pass|passes|passed|run|runs|ran|matrix|runner|job|jobs|suite|suites|workflow|fail|fails|failed|green|red|ci|environment|infrastructure|setup|harness|helpers?|utils?|command|script|step|stage)\b)|\btests? (?:added|included|written)\b/i;
const DOCS = /\b(updat(?:e|es|ed|ing)|add(?:s|ed|ing)?|improv(?:e|es|ed|ing)|wr(?:ite|ote|ites)|expand(?:s|ed)?|extend(?:s|ed)?)\b(?:(?!\b(?:in|per|from|according to|into|on|via)\b)[^.\n]){0,30}?\b(docs?|documentation|readme|changelog)\b(?!\s*(?:link|links|url|urls|site|website|page|pages|build|deploy|says|said|states|mention|mentions|ci|workflow|job)\b)/i;

/** Lines of Markdown, each marked as code (fenced, indented or in <pre>) or not. @param {string} markdown */
function lines(markdown) {
  /** @type {{text: string, line: number, code: boolean}[]} */
  const out = [];
  let fence = "";
  let pre = false;
  let prevBlank = true;
  markdown.replace(/\r\n?/g, "\n").split("\n").forEach((/** @type {string} */ text, /** @type {number} */ i) => {
    const f = text.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (f && f[1]) {
      if (!fence) { fence = f[1][0] ?? "`"; out.push({ text, line: i + 1, code: true }); return; }
      if (f[1][0] === fence) { fence = ""; out.push({ text, line: i + 1, code: true }); return; }
    }
    if (/<pre\b/i.test(text)) pre = true;
    // An indented code block: four spaces (or a tab) after a blank line, outside lists.
    const indented = !fence && !pre && prevBlank && /^( {4}|\t)/.test(text) && !/^\s*([-*+]|\d+\.)\s/.test(text);
    out.push({ text, line: i + 1, code: !!fence || pre || indented });
    if (/<\/pre>/i.test(text)) pre = false;
    prevBlank = !text.trim() ? true : indented ? true : false;
  });
  return out;
}

/** Drops HTML comments (PR templates leave their instructions in them), keeping the line count. @param {string} markdown */
function strip(markdown) {
  return markdown.replace(/<!--[\s\S]*?-->/g, (/** @type {string} */ m) => m.replace(/[^\n]/g, ""));
}

/** A task-list item, ticked or not: a template's question, not the author's statement. */
const CHECKBOX = /^\s*([-*+]|\d+[.)])\s+\[[ xX]\]/;
const UNTICKED = /^\s*([-*+]|\d+[.)])\s+\[ \]/;

/**
 * @param {string} markdown
 * @param {{lineOffset?: number, maxPerKind?: number}} [o] lineOffset: 0 for the title (reported as "title")
 * @returns {Claims}
 */
export function extractClaims(markdown, o = {}) {
  const max = o.maxPerKind ?? 40;
  const shift = o.lineOffset ?? 1;
  /** @type {Claims} */
  const c = { paths: [], symbols: [], options: [], refs: [], advisories: [], tests: null, docs: null };
  const seen = new Set();
  const add = (/** @type {Mention[]} */ list, /** @type {Mention & Record<string, unknown>} */ m, /** @type {string} */ key) => {
    if (seen.has(key) || list.length >= max) return;
    seen.add(key);
    list.push(m);
  };
  for (const { text, line: n, code } of lines(strip(markdown ?? ""))) {
    const line = n - 1 + shift;
    if (/^\s*>/.test(text)) continue; // a quote of someone else
    if (UNTICKED.test(text)) continue; // an unticked template item says nothing yet
    if (code) {
      for (const m of text.matchAll(TRACE_PATH)) {
        const p = framePath(m[1] ?? m[2] ?? m[3] ?? m[4] ?? "");
        if (p) add(c.paths, { ...p, frame: true, line }, `p:${p.text}`);
      }
      continue;
    }
    // Inline code spans (and <code> elements).
    const prose = text.replace(/<code>([^<]*)<\/code>|`([^`\n]+)`/g, (/** @type {string} */ whole, /** @type {string} */ html, /** @type {string} */ md) => {
      const span = md ?? html ?? "";
      const p = asPath(span);
      const s = asSymbol(span);
      const opt = asOption(span);
      if (p) add(c.paths, { text: p, line }, `p:${p}`);
      else if (s) add(c.symbols, { text: span.trim(), name: s, line }, `s:${s}`);
      else if (opt) add(c.options, { text: opt, line }, `o:${opt}`);
      return " ".repeat(whole.length); // keep positions; code is not prose
    });
    for (const m of prose.matchAll(REF_URL)) {
      const number = Number(m[3]);
      const closing = CLOSING.test(prose.slice(0, m.index ?? 0));
      add(/** @type {any} */ (c.refs), { owner: m[1], repo: m[2], number, closing, line, text: m[0] }, `r:${m[1]}/${m[2]}#${number}:${closing}`);
    }
    const noUrls = prose.replace(REF_URL, (m) => " ".repeat(m.length)).replace(/https?:\/\/\S+/g, (m) => " ".repeat(m.length));
    const colours = COLOUR_CONTEXT.test(noUrls);
    for (const m of noUrls.matchAll(REF)) {
      const digits = m[3] ?? "";
      const before = noUrls.slice(0, m.index ?? 0);
      if (/^0/.test(digits)) continue; // #0, #000: not an issue number
      if (colours && /^(\d{3}|\d{6})$/.test(digits)) continue; // #333 in a line about colours
      if (NOT_A_REF_BEFORE.test(before) || (/\bthe\s*$/i.test(before) && digits.length === 1)) continue; // "step #1", "the #1 cause"
      const number = Number(digits);
      const closing = CLOSING.test(before);
      const owner = m[1];
      const repo = m[2];
      add(/** @type {any} */ (c.refs), { ...(owner && repo ? { owner, repo } : {}), number, closing, line, text: m[0] }, `r:${owner ?? ""}/${repo ?? ""}#${number}:${closing}`);
    }
    for (const m of prose.matchAll(ADVISORY)) {
      const raw = m[1] ?? "";
      const id = /^cve/i.test(raw) ? raw.toUpperCase() : `GHSA${raw.slice(4).toLowerCase()}`;
      add(c.advisories, { text: id, line }, `a:${id}`);
    }
    if (CHECKBOX.test(text)) continue; // ticked template items ("I've added tests") are not statements either
    for (const [key, re] of /** @type {const} */ ([["tests", TESTS], ["docs", DOCS]])) {
      if (c[key]) continue;
      for (const sentence of prose.split(/(?<=[.!?;])\s+|\s+-\s+/)) {
        const hit = sentence.match(re);
        if (!hit) continue;
        const upTo = sentence.slice(0, (hit.index ?? 0) + hit[0].length);
        if (NEGATED.test(upTo) || NOT_A_STATEMENT.test(sentence)) continue;
        // A report of a test run ("456 passed", "the 10 tests") is a result, not a statement that tests were added.
        if (key === "tests" && TEST_RESULT.test(sentence)) continue;
        c[key] = { text: sentence.trim().slice(0, 120), line };
        break;
      }
    }
  }
  return c;
}
