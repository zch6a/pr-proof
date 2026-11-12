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
export const EXT = /\.(js|mjs|cjs|jsx|ts|mts|cts|tsx|py|pyi|pyx|rb|go|rs|java|kt|kts|scala|groovy|swift|c|cc|cpp|cxx|h|hh|hpp|cu|cuh|cs|fs|vb|php|pl|pm|t|lua|r|jl|m|mm|dart|ex|exs|erl|hs|ml|clj|nim|zig|v|d|f90|sol|tf|hcl|sh|bash|zsh|fish|ps1|psm1|bat|cmd|sql|graphql|proto|vue|svelte|astro|html?|css|scss|sass|less|md|mdx|rst|adoc|txt|json|jsonc|ya?ml|toml|ini|cfg|conf|xml|gradle|cmake|mk|lock|dockerfile|ejs|hbs|tmpl|tpl|ipynb)$/i;
const NAMED_FILES = /^(Makefile|Dockerfile|Rakefile|Gemfile|Procfile|Justfile|CMakeLists\.txt|LICENSE|README(\.\w+)?|CHANGELOG(\.\w+)?|CHANGES(\.\w+)?|CONTRIBUTING(\.\w+)?|go\.mod|go\.sum|Cargo\.toml|package\.json|pyproject\.toml|setup\.py)$/;

/** Words in code spans that stand for something rather than name it. */
const PLACEHOLDER = /^(<.*>|\{.*\}|\$\{?\w+\}?|\.\.\.|…|foo|bar|baz|qux|example|your[-_]\w+|my[-_]\w+|path\/to\/.*|some[-_]?\w*|xxx+)$/i;
/** Folders of dependencies and environments: never the repository's own files. */
const FOREIGN = /(^|\/)(node_modules|site-packages|dist-packages|\.venv|venv|env|vendor|\.git|\.cargo|go\/pkg\/mod|bower_components|\.m2|\.gradle)(\/|$)/;

/**
 * A file or folder path in inline code: relative, no spaces, not a URL, a glob, a placeholder or a system path, and
 * with a directory: a bare name (`sample.txt`, `express.json`, `Node.js`, `docs.rs`) is too often the reader's own
 * file, a library or a site to count as a statement about this repository.
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
  if (/^\d+(\.\d+)+$/.test(name)) return null;
  return s;
}

/** Calls on standard libraries and well-known globals: not the repository's functions. */
const STDLIB = /^(JSON|Math|Object|Array|Promise|Number|String|Date|Reflect|Symbol|Intl|console|window|document|navigator|process|Buffer|URL|crypto|fs|path|os|sys|re|json|math|time|datetime|subprocess|shutil|itertools|functools|collections|typing|asyncio|logging|pathlib|random|threading|std|core|alloc|tokio|fmt|strings|strconv|errors|io|ioutil|bytes|sort|http|net|filepath|reflect|context|sync|log|maps|slices|atomic|java|javax|System|Integer|Long|Double|Boolean|Character|Collections|Collectors|Arrays|Objects|Optional|Thread|Executors|CompletableFuture|Files|Paths|Stream|List|Map|Set|Math|Console|Task|Enumerable|ArgumentNullException|ArgumentException|Environment|Guid|DispatchQueue|Task|torch|np|numpy|pd|pandas|Foundation|UIKit)$/;
/** Built-in functions called bare: Python, PHP, JavaScript, C. */
const BUILTIN_FUNCTIONS = /^(print|len|range|open|eval|exec|breakpoint|isinstance|getattr|setattr|hasattr|super|sorted|enumerate|zip|map|filter|repr|vars|dir|input|id|hash|iter|next|str_contains|str_starts_with|str_ends_with|array_map|array_filter|in_array|json_encode|json_decode|var_dump|print_r|preg_match|sprintf|printf|implode|explode|isset|unset|empty|setTimeout|setInterval|clearTimeout|fetch|require|parseInt|parseFloat|structuredClone|queueMicrotask|malloc|free|memcpy|strlen|strcmp|assert|panic|recover|make|append|ConfigureAwait)$/;

/** A function in inline code: `name()`, `obj.name(x)`, `Mod::name()`; the name looked for is the last segment. @param {string} code */
export function asSymbol(code) {
  const m = code.trim().match(/^((?:[A-Za-z_$][\w$]*(?:\.|::|->|#))*)([A-Za-z_$][\w$]*)\s*\([^()]*\)$/);
  if (!m) return null;
  const name = m[2] ?? "";
  const first = (m[1] ?? "").split(/\.|::|->|#/)[0] ?? "";
  // A built-in called bare (`str_contains()`), or a method every object of a platform has (`.ConfigureAwait()`).
  if (name.length < 3 || PLACEHOLDER.test(name) || (first && STDLIB.test(first)) || (BUILTIN_FUNCTIONS.test(name) && (!first || name === "ConfigureAwait"))) return null;
  return name;
}

/** Options every command-line framework adds by itself, and options of the tools everyone uses (git, npm, pip, cargo). */
const NOT_THIS_PROJECTS_OPTIONS = new Set([
  "--help", "--version", "--verbose", "--quiet", "--debug",
  "--force", "--force-with-lease", "--no-verify", "--amend", "--rebase", "--no-ff", "--squash", "--signoff", "--depth", "--recursive", "--global", "--local", "--hard", "--soft", "--cached", "--staged", "--stat", "--oneline", "--all", "--prune", "--tags",
  "--save", "--save-dev", "--save-exact", "--legacy-peer-deps", "--force-install", "--frozen-lockfile", "--production", "--ignore-scripts", "--workspace", "--workspaces", "--registry",
  "--user", "--upgrade", "--no-cache-dir", "--editable", "--pre", "--index-url", "--extra-index-url", "--break-system-packages", "--no-deps", "--requirement",
  "--release", "--locked", "--offline", "--all-features", "--no-default-features", "--features", "--target", "--workspace", "--nocapture", "--test-threads",
]);

/** A long command-line option in inline code: `--dry-run`, `--max-size=10`. @param {string} code */
export function asOption(code) {
  const m = code.trim().match(/^(--[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*)(?:[= ].*)?$/i);
  const o = m?.[1];
  return o && !NOT_THIS_PROJECTS_OPTIONS.has(o.toLowerCase()) ? o : null;
}

const CLOSING = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+$/i;
const REF = /(?<![\w/#&])(?:([A-Za-z0-9][\w.-]{0,38})\/([\w.-]{1,100}))?#(\d{1,7})\b/g;
const REF_URL = /https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(?:issues|pull|discussions)\/(\d+)\b/g;
/** Words before a number that make it an ordinal, a label or another tracker's: "step #1", "Debian bug #1012345". */
const NOT_A_REF_BEFORE = /\b(step|item|number|no\.?|rank(?:ed)?|top|phase|point|part|round|level|line|row|attempt|try|case|example|option|choice|place|position|version|v|page|slide|figure|fig\.?|table|chapter|section|question|q|task|day|week|episode|track|build|run|job|commit|frame|ticket|bug|jira|bugzilla|bz|debian|ubuntu|launchpad|redmine|trac|mantis|rt|crbug|chromium|mozilla|webkit|llvm|gcc|python|bpo|rhbz|lp)\s*$/i;
/** A line about colours: `#333` there is a colour, not issue 333. */
const COLOUR_CONTEXT = /\b(colou?rs?|background|foreground|fill|stroke|border|hex|rgba?|hsl|css|theme|palette|shade)\b/i;
/** A frame of a stack trace written as prose: PHP `#0 /var/www/...`, gdb `#1  0x0000 in ...`, `#18 {main}`. */
const FRAME_LINE = /^\s*#\d+\s+(?:[/\\.[]|[A-Za-z]:\\|0x[0-9a-f]+|\{main\}|\w+\s*\(|in\s)/i;
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
const NEGATED = /\b(no|none|not|without|never|lack(?:s|ing)?|missing|skip(?:ped|s)?|todo|cannot|unable|nor|removes?|removed|removing|deletes?|deleted|drops?|dropped)\b|n['’]t\b/i;
/** A template's answer after the claim: "Tests added: No", "Added tests: none needed", "Docs updated: n/a". */
const ANSWERED_NO = /[:?*]\s*\**\s*(?:no|none|nope|n\/?a|not\s+applicable|not\s+needed|-|—|false)\b/i;
const NOT_A_STATEMENT = /\?\s*$|\b(if|please|should|could|would|might|may|need to|needs to|happy to|feel free|plan(?:s|ning)? to|going to|want to|wants to|let me know|follow[- ]?up|later|eventually|to be added|will|shall)\b|['’]ll\b/i;
const TEST_RESULT = /\b\d+\s+(?:passed|passing|failed|failing|skipped|ignored|tests?|specs?|cases?)\b|\b(?:passed|passes|passing|green|succeed(?:s|ed)?)\b/i;
/** Things about tests that are not tests: speeding them up, their data, ids, plans. */
const NOT_ABOUT_ADDING_TESTS = /\b(speed(?:s|ing)?\s+up|faster|slow(?:er)?|flaky|cach(?:e|es|ing)|existing\s+tests?|covered\s+by|test\s*-?\s*(?:id|ids|only|plan|plans|database|db|container|account|user|users|server|env|environment|harness|double|doubles|key|token|mode|flag|hook|helper|utility|attribute|selector|data|fixture\s+server|matrix|runner|command|script|step|job|run|type))\b/i;
const TESTS = /\b(add(?:s|ed|ing)?|includ(?:e|es|ed)|wr(?:ite|ote|itten|ites)|new|extend(?:s|ed)?)\b(?:(?!\d|\b(?:runs?|running|ran|execut\w*|trigger\w*|invok\w*)\b)[^.\n]){0,40}?\b(?:(?:unit |integration |e2e |end-to-end |regression |snapshot |more |some |a few |new )?tests\b|(?:an? |one |new )(?:unit |integration |e2e |regression |snapshot )?test\b|test cases?\b)(?!\s*(?:pass|passes|passed|run|runs|ran|matrix|runner|job|jobs|suite|suites|workflow|fail|fails|failed|green|red|ci|on\s+ci|environment|infrastructure|setup|harness|helpers?|utils?|command|script|step|stage)\b)|^\W*tests? (?:added|included|written)\b/i;
const DOCS = /\b(updat(?:e|es|ed|ing)|add(?:s|ed|ing)?|improv(?:e|es|ed|ing)|wr(?:ite|ote|ites)|expand(?:s|ed)?|extend(?:s|ed)?)\b(?:(?!\b(?:in|per|from|according to|into|on|via|link|links|url|pointer|reference)\b)[^.\n]){0,30}?\b(docs?|documentation|readme|changelog)\b(?!\s*(?:link|links|url|urls|site|website|page|pages|build|deploy|says|said|states|mention|mentions|ci|workflow|job)\b)/i;

/** Lines of Markdown, each marked as code (fenced, indented or in <pre>), quoted (> or <blockquote>) or prose. @param {string} markdown */
function lines(markdown) {
  /** @type {{text: string, line: number, code: boolean, quoted: boolean}[]} */
  const out = [];
  let fence = "";
  let pre = false;
  let quote = 0;
  let prevBlank = true;
  markdown.replace(/\r\n?/g, "\n").split("\n").forEach((/** @type {string} */ text, /** @type {number} */ i) => {
    // A fence may be indented (inside a list item); it closes with the same character.
    const f = text.match(/^\s*(?:[-*+]\s+|\d+[.)]\s+)?(`{3,}|~{3,})/);
    if (f && f[1]) {
      if (!fence) { fence = f[1][0] ?? "`"; out.push({ text, line: i + 1, code: true, quoted: false }); return; }
      if (f[1][0] === fence) { fence = ""; out.push({ text, line: i + 1, code: true, quoted: false }); return; }
    }
    if (/<pre\b/i.test(text)) pre = true;
    quote += (text.match(/<blockquote\b/gi) ?? []).length;
    // An indented code block: four spaces (or a tab) after a blank line, outside lists.
    const indented = !fence && !pre && prevBlank && /^( {4}|\t)/.test(text) && !/^\s*([-*+]|\d+\.)\s/.test(text);
    out.push({ text, line: i + 1, code: !!fence || pre || indented, quoted: quote > 0 || /^\s*>/.test(text) });
    if (/<\/pre>/i.test(text)) pre = false;
    quote = Math.max(0, quote - (text.match(/<\/blockquote>/gi) ?? []).length);
    prevBlank = !text.trim() ? true : indented ? true : false;
  });
  return out;
}

/**
 * Drops HTML comments (PR templates leave their instructions in them), keeping the line count. An unclosed `<!--`
 * hides the rest of the text on GitHub, so it hides it here too.
 * @param {string} markdown
 */
function strip(markdown) {
  const blank = (/** @type {string} */ m) => m.replace(/[^\n]/g, "");
  return markdown.replace(/<!--[\s\S]*?-->/g, blank).replace(/<!--[\s\S]*$/, blank);
}

/** A task-list item, ticked or not, or a status mark: a template's question, not the author's statement. */
const CHECKBOX = /^\s*(?:(?:[-*+]|\d+[.)])\s+)?\[[ xX\-~]\]|^\s*(?:[-*+]\s+)?(?:❌|✅|✔️?|☐|☑️?|⬜)/;
const UNTICKED = /^\s*(?:(?:[-*+]|\d+[.)])\s+)?\[[ \-~]\]/;
/** A line of release notes copied from elsewhere: "* Added tests for parser by @bob in https://github.com/...". */
const COPIED_NOTE = /\bby @[\w-]+(?:\[bot\])? in https?:\/\/|@[\w-]+ made (?:their|his|her) first contribution in https?:\/\//i;
/** Markdown and HTML links: their text belongs to where they point. */
const MD_LINK = /\[([^\]\n]*)\]\((https?:\/\/[^)\s]+)[^)]*\)/g;
const HTML_LINK = /<a\s[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

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
  for (const { text, line: n, code, quoted } of lines(strip(markdown ?? ""))) {
    const line = n - 1 + shift;
    if (quoted || COPIED_NOTE.test(text)) continue; // someone else's words
    if (UNTICKED.test(text)) continue; // an unticked template item says nothing yet
    if (code) {
      // Frames are counted, never reported: a relative frame is as often the reporter's own app as this repository.
      for (const m of text.matchAll(TRACE_PATH)) {
        const p = framePath(m[1] ?? m[2] ?? m[3] ?? m[4] ?? "");
        if (p) add(c.paths, { ...p, frame: true, line }, `p:${p.text}`);
      }
      continue;
    }
    if (FRAME_LINE.test(text)) continue; // an unfenced frame of a stack trace
    // Links: a link to github.com issues is a reference (read below from its URL); the text of any link, code in it
    // included, is about where it points, not about this repository.
    const linked = text
      .replace(MD_LINK, (/** @type {string} */ whole, /** @type {string} */ _t, /** @type {string} */ url) => `${" ".repeat(whole.length - url.length - 1)}${url} `)
      .replace(HTML_LINK, (/** @type {string} */ whole, /** @type {string} */ url) => `${url}${" ".repeat(Math.max(0, whole.length - url.length))}`);
    // Inline code spans (and <code> elements).
    const prose = linked.replace(/<code>([^<]*)<\/code>|`([^`\n]+)`/g, (/** @type {string} */ whole, /** @type {string} */ html, /** @type {string} */ md) => {
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
      const closing = CLOSING.test(prose.slice(0, m.index ?? 0).replace(/[\s*_[(]+$/, " "));
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
      const closing = CLOSING.test(before.replace(/[\s*_]+$/, " "));
      const owner = m[1];
      const repo = m[2];
      add(/** @type {any} */ (c.refs), { ...(owner && repo ? { owner, repo } : {}), number, closing, line, text: m[0] }, `r:${owner ?? ""}/${repo ?? ""}#${number}:${closing}`);
    }
    for (const m of prose.matchAll(ADVISORY)) {
      const raw = m[1] ?? "";
      const id = /^cve/i.test(raw) ? raw.toUpperCase() : `GHSA${raw.slice(4).toLowerCase()}`;
      add(c.advisories, { text: id, line }, `a:${id}`);
    }
    if (CHECKBOX.test(text)) continue; // template items ("- [x] I've added tests") are not statements either
    for (const [key, re] of /** @type {const} */ ([["tests", TESTS], ["docs", DOCS]])) {
      if (c[key]) continue;
      // Sentences, with their place in the line: the quote is taken from the line as written, code and all.
      // A sentence ends at . ! ? ; followed by a space or the end: `utils.compileETag` is not two sentences.
      for (const s of prose.matchAll(/(?:[^.!?;\n]|[.!?;](?=\S))+[.!?;]?/g)) {
        const sentence = s[0];
        const hit = sentence.match(re);
        if (!hit) continue;
        const upTo = sentence.slice(0, (hit.index ?? 0) + hit[0].length);
        const after = sentence.slice((hit.index ?? 0) + hit[0].length);
        if (NEGATED.test(upTo) || NOT_A_STATEMENT.test(sentence) || ANSWERED_NO.test(after)) continue;
        // A report of a test run ("456 passed", "the 10 tests") is a result, not a statement that tests were added.
        if (key === "tests" && (TEST_RESULT.test(sentence) || NOT_ABOUT_ADDING_TESTS.test(sentence))) continue;
        const start = s.index ?? 0;
        c[key] = { text: text.slice(start, start + sentence.length).trim().slice(0, 120), line };
        break;
      }
    }
  }
  return c;
}
