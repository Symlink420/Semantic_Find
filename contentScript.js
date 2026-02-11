let chunks = [];
let currentHighlightId = null;
let currentHighlightNode = null;

function isVisible(el) {
  const rect = el.getBoundingClientRect();
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    window.getComputedStyle(el).visibility !== "hidden" &&
    window.getComputedStyle(el).display !== "none"
  );
}

function collectTextChunks() {
  const blocks = Array.from(
    document.querySelectorAll(
      "p, li, blockquote, pre, code, article, section, div, h1, h2, h3, h4, h5, h6"
    )
  );

  const list = [];
  let id = 0;

  for (const el of blocks) {
    if (!isVisible(el)) continue;
    const text = el.innerText.trim();
    if (!text) continue;

    let type = "text";
    const tag = el.tagName.toLowerCase();

    if (tag === "pre" || tag === "code") {
      type = "code";
    } else if (/^h[1-6]$/.test(tag)) {
      type = "headings";
    } else {
      type = "text";
    }

    list.push({
      id: `chunk-${id++}`,
      el,
      text,
      type
    });
  }

  chunks = list;
}

// Basic stopword list just to downweight “noise”.
const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "if",
  "then",
  "so",
  "of",
  "in",
  "on",
  "for",
  "to",
  "is",
  "are",
  "was",
  "were",
  "it",
  "this",
  "that",
  "with",
  "as",
  "by",
  "at",
  "be",
  "from"
]);

function tokenize(str) {
  return str
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !STOPWORDS.has(t));
}

function similarityScore(query, text) {
  const qTokens = tokenize(query);
  const tTokens = tokenize(text);
  if (!qTokens.length || !tTokens.length) return 0;

  const tSet = new Set(tTokens);
  let match = 0;
  qTokens.forEach((t) => {
    if (tSet.has(t)) match += 1;
  });
  const base = match / qTokens.length;

  const qLower = query.toLowerCase();
  const tLower = text.toLowerCase();
  const containsExact = tLower.includes(qLower);

  // Boost exact substring matches.
  const boost = containsExact ? 0.3 : 0;

  return Math.min(1, base + boost);
}

function clearHighlight() {
  if (!currentHighlightNode) return;
  const span = currentHighlightNode;
  const parent = span.parentNode;
  while (span.firstChild) parent.insertBefore(span.firstChild, span);
  parent.removeChild(span);
  currentHighlightNode = null;
  currentHighlightId = null;
}

function highlightChunk(chunkId) {
  if (currentHighlightId === chunkId) return;
  clearHighlight();

  const chunk = chunks.find((c) => c.id === chunkId);
  if (!chunk) return;

  const el = chunk.el;
  const span = document.createElement("span");
  span.style.backgroundColor = "yellow";
  span.style.color = "black";
  span.style.padding = "2px";

  // Wrap whole element content.
  while (el.firstChild) {
    span.appendChild(el.firstChild);
  }
  el.appendChild(span);

  currentHighlightNode = span;
  currentHighlightId = chunkId;
  span.scrollIntoView({ behavior: "smooth", block: "center" });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SEMANTIC_SEARCH") {
    if (!chunks.length) collectTextChunks();

    const query = message.query;
    const mode = message.mode || "all";

    let filtered = chunks;
    if (mode === "text") {
      filtered = chunks.filter((c) => c.type === "text");
    } else if (mode === "code") {
      filtered = chunks.filter((c) => c.type === "code");
    } else if (mode === "headings") {
      filtered = chunks.filter((c) => c.type === "headings");
    }

    let results;

    if (message.semantic) {
      results = filtered
        .map((c) => ({
          id: c.id,
          preview: c.text.slice(0, 160),
          score: similarityScore(query, c.text)
        }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 50);
    } else {
      const qLower = query.toLowerCase();
      results = filtered
        .filter((c) => c.text.toLowerCase().includes(qLower))
        .map((c) => ({
          id: c.id,
          preview: c.text.slice(0, 160),
          score: 1
        }))
        .slice(0, 50);
    }

    sendResponse({ results });
    return true;
  }

  if (message.type === "SEMANTIC_JUMP_TO") {
    highlightChunk(message.id);
  }
});
