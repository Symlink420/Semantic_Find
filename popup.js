const queryInput   = document.getElementById("query");
const resultsDiv   = document.getElementById("results");
const statusLabel  = document.getElementById("statusLabel");
const semanticToggle = document.getElementById("semanticToggle");
const modeSelect   = document.getElementById("modeSelect");
const prevBtn      = document.getElementById("prevBtn");
const nextBtn      = document.getElementById("nextBtn");
const countLabel   = document.getElementById("countLabel");

let currentResults = [];
let currentIndex   = -1;
let debounceTimer  = null;
let activeTabId    = null;

// Cache the active tab ID once at startup to avoid repeated queries.
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  activeTabId = tabs[0]?.id ?? null;
});

// ─── UI helpers ───────────────────────────────────────────────────────────────

function setStatus(msg) {
  if (statusLabel) statusLabel.textContent = msg;
}

function updateCountLabel() {
  countLabel.textContent = currentResults.length
    ? `${currentIndex + 1}/${currentResults.length}`
    : "0/0";
}

function renderResults() {
  resultsDiv.innerHTML = "";
  currentResults.forEach((r, idx) => {
    const div = document.createElement("div");
    div.className = "result" + (idx === currentIndex ? " active" : "");
    div.textContent = `${idx + 1}. ${r.preview}`;
    div.addEventListener("click", () => jumpToResult(idx));
    resultsDiv.appendChild(div);
  });
  updateCountLabel();
}

// ─── Messaging ────────────────────────────────────────────────────────────────

function safeSendMessage(tabId, payload, callback) {
  chrome.tabs.sendMessage(tabId, payload, (response) => {
    if (chrome.runtime.lastError) {
      // Content script not available on this page (e.g. chrome:// URLs).
      setStatus("Cannot run on this page.");
      callback?.(null);
      return;
    }
    callback?.(response);
  });
}

// ─── Search ───────────────────────────────────────────────────────────────────

function sendSearch() {
  const text = queryInput.value.trim();

  if (!text) {
    currentResults = [];
    currentIndex   = -1;
    renderResults();
    setStatus("");
    return;
  }

  if (!activeTabId) return;

  setStatus("Searching…");

  safeSendMessage(
    activeTabId,
    {
      type: "SEMANTIC_SEARCH",
      query: text,
      semantic: semanticToggle.checked,
      mode: modeSelect.value,
    },
    (response) => {
      if (!response?.results?.length) {
        currentResults = [];
        currentIndex   = -1;
        renderResults();
        setStatus("No results.");
        return;
      }

      currentResults = response.results;
      currentIndex   = 0;
      renderResults();
      setStatus("");

      safeSendMessage(activeTabId, {
        type: "SEMANTIC_JUMP_TO",
        id: currentResults[0].id,
      });
    }
  );
}

function debouncedSearch() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(sendSearch, 250);
}

// ─── Navigation ───────────────────────────────────────────────────────────────

function jumpToResult(idx) {
  if (!currentResults.length || !activeTabId) return;
  currentIndex = ((idx % currentResults.length) + currentResults.length) % currentResults.length;
  renderResults();
  safeSendMessage(activeTabId, {
    type: "SEMANTIC_JUMP_TO",
    id: currentResults[currentIndex].id,
  });
}

// ─── Event listeners ─────────────────────────────────────────────────────────

queryInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    sendSearch();
  } else if (e.key === "ArrowDown" && e.altKey) {
    jumpToResult(currentIndex + 1);
    e.preventDefault();
  } else if (e.key === "ArrowUp" && e.altKey) {
    jumpToResult(currentIndex - 1);
    e.preventDefault();
  }
});

queryInput.addEventListener("input", debouncedSearch);
semanticToggle.addEventListener("change", sendSearch);
modeSelect.addEventListener("change", sendSearch);

prevBtn.addEventListener("click", () => jumpToResult(currentIndex - 1));
nextBtn.addEventListener("click", () => jumpToResult(currentIndex + 1));

// Focus the input immediately when the popup opens.
queryInput.focus();
