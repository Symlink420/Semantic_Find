// ─── State ────────────────────────────────────────────────────────────────────

let chunks = [];
let chunksStale = true; // invalidated by MutationObserver
let currentHighlightEl = null;
let currentHighlightStyles = null; // saved originals for non-destructive restore
let currentHighlightId = null;

// ─── DOM change watcher (SPA support) ─────────────────────────────────────────

const domObserver = new MutationObserver(() => {
  chunksStale = true;
});

domObserver.observe(document.body, {
  childList: true,
  subtree: true,
});

// ─── Visibility ───────────────────────────────────────────────────────────────

function isVisible(el) {
  const style = window.getComputedStyle(el);
  if (style.visibility === "hidden" || style.display === "none") return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

// ─── Chunk collection ─────────────────────────────────────────────────────────

// Tags that, when present as children, mark a parent as a "container" rather
// than a leaf content block. We never want to index the container — only its
// children — because that would produce near-duplicate entries.
const BLOCK_CHILD_TAGS = new Set([
  "P", "LI", "BLOCKQUOTE", "PRE", "CODE",
  "H1", "H2", "H3", "H4", "H5", "H6",
]);

function hasBlockChildren(el) {
  for (const child of el.children) {
    if (BLOCK_CHILD_TAGS.has(child.tagName)) return true;
  }
  return false;
}

function collectTextChunks() {
  // Leaf-first selectors: precise tags first, then containers only when they
  // have no block-level children (i.e., they ARE the leaf for their text).
  const candidates = Array.from(
    document.querySelectorAll(
      "p, li, blockquote, pre, code, h1, h2, h3, h4, h5, h6, div, section, article"
    )
  );

  const seen = new Set();
  const list = [];
  let id = 0;

  for (const el of candidates) {
    if (!isVisible(el)) continue;

    const tag = el.tagName.toLowerCase();
    const isContainer = tag === "div" || tag === "section" || tag === "article";

    // Skip containers whose block-level children will be (or were) indexed
    // independently — avoids duplicate / superset entries.
    if (isContainer && hasBlockChildren(el)) continue;

    const text = el.innerText?.trim();
    if (!text || text.length < 10) continue; // skip trivially short nodes

    // Deduplicate identical text (e.g. visually hidden duplicates)
    if (seen.has(text)) continue;
    seen.add(text);

    let type = "text";
    if (tag === "pre" || tag === "code") type = "code";
    else if (/^h[1-6]$/.test(tag)) type = "headings";

    list.push({ id: `chunk-${id++}`, el, text, type });
  }

  chunks = list;
  chunksStale = false;
}

function ensureChunks() {
  if (chunksStale || !chunks.length) collectTextChunks();
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "then", "so",
  "of", "in", "on", "for", "to", "is", "are", "was", "were",
  "it", "this", "that", "with", "as", "by", "at", "be", "from",
]);

function tokenize(str) {
  return str
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function similarityScore(query, text) {
  const qTokens = tokenize(query);
  const tTokens = tokenize(text);
  if (!qTokens.length || !tTokens.length) return 0;

  // Token overlap with partial (prefix) matching for better recall.
  // "component" will match "components", "computing" will not.
  let match = 0;
  for (const qt of qTokens) {
    // Exact match scores 1, prefix match (stem) scores 0.6
    if (tTokens.includes(qt)) {
      match += 1;
    } else if (tTokens.some((tt) => tt.startsWith(qt) || qt.startsWith(tt))) {
      match += 0.6;
    }
  }

  const base = match / qTokens.length;

  // Boost chunks that contain the full query as a substring.
  const exactBoost = text.toLowerCase().includes(query.toLowerCase()) ? 0.3 : 0;

  // Length penalty: prefer focused chunks over huge containers that happen to
  // share a word.
  const lengthPenalty = Math.max(0, (text.length - 800) / 8000); // 0 up to 800 chars

  return Math.min(1, base + exactBoost - lengthPenalty);
}

// ─── Highlight (non-destructive) ─────────────────────────────────────────────

const HIGHLIGHT_STYLE = {
  backgroundColor: "#fff176",
  color: "#000",
  outline: "2px solid #f9a825",
  borderRadius: "3px",
};

function clearHighlight() {
  if (!currentHighlightEl) return;
  // Restore exact original inline styles
  for (const prop of Object.keys(HIGHLIGHT_STYLE)) {
    currentHighlightEl.style[prop] = currentHighlightStyles[prop] ?? "";
  }
  currentHighlightEl = null;
  currentHighlightStyles = null;
  currentHighlightId = null;
}

function highlightChunk(chunkId) {
  if (currentHighlightId === chunkId) return;
  clearHighlight();

  const chunk = chunks.find((c) => c.id === chunkId);
  if (!chunk) return;

  const el = chunk.el;

  // Save originals before touching anything
  currentHighlightStyles = {};
  for (const prop of Object.keys(HIGHLIGHT_STYLE)) {
    currentHighlightStyles[prop] = el.style[prop];
  }

  Object.assign(el.style, HIGHLIGHT_STYLE);
  currentHighlightEl = el;
  currentHighlightId = chunkId;

  el.scrollIntoView({ behavior: "smooth", block: "center" });
}

// ─── Message handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "SEMANTIC_SEARCH") {
    ensureChunks();

    const { query, mode = "all", semantic = true } = message;

    let filtered = chunks;
    if (mode === "text")     filtered = chunks.filter((c) => c.type === "text");
    else if (mode === "code")     filtered = chunks.filter((c) => c.type === "code");
    else if (mode === "headings") filtered = chunks.filter((c) => c.type === "headings");

    let results;

    if (semantic) {
      results = filtered
        .map((c) => ({
          id: c.id,
          preview: c.text.slice(0, 160),
          score: similarityScore(query, c.text),
        }))
        .filter((r) => r.score > 0.05) // drop near-zero noise
        .sort((a, b) => b.score - a.score)
        .slice(0, 50);
    } else {
      const qLower = query.toLowerCase();
      results = filtered
        .filter((c) => c.text.toLowerCase().includes(qLower))
        .map((c) => ({ id: c.id, preview: c.text.slice(0, 160), score: 1 }))
        .slice(0, 50);
    }

    sendResponse({ results });
    return true; // keep message channel open for async response
  }

  if (message.type === "SEMANTIC_JUMP_TO") {
    highlightChunk(message.id);
  }

  if (message.type === "SEMANTIC_REINDEX") {
    chunksStale = true;
    ensureChunks();
    sendResponse({ count: chunks.length });
    return true;
  }
});
