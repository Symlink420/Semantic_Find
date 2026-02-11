const queryInput = document.getElementById("query");
const resultsDiv = document.getElementById("results");
const semanticToggle = document.getElementById("semanticToggle");
const modeSelect = document.getElementById("modeSelect");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const countLabel = document.getElementById("countLabel");

let currentResults = [];
let currentIndex = -1;
let debounceTimer = null;

function updateCountLabel() {
  if (!currentResults.length) {
    countLabel.textContent = "0/0";
  } else {
    countLabel.textContent = `${currentIndex + 1}/${currentResults.length}`;
  }
}

function renderResults() {
  resultsDiv.innerHTML = "";
  currentResults.forEach((r, idx) => {
    const div = document.createElement("div");
    div.className = "result" + (idx === currentIndex ? " active" : "");
    div.textContent = `${idx + 1}. ${r.preview}`;
    div.addEventListener("click", () => {
      jumpToResult(idx);
    });
    resultsDiv.appendChild(div);
  });
  updateCountLabel();
}

function sendSearch() {
  const text = queryInput.value.trim();
  if (!text) {
    currentResults = [];
    currentIndex = -1;
    renderResults();
    return;
  }

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs[0].id;
    chrome.tabs.sendMessage(
      tabId,
      {
        type: "SEMANTIC_SEARCH",
        query: text,
        semantic: semanticToggle.checked,
        mode: modeSelect.value
      },
      (response) => {
        if (!response || !response.results || !response.results.length) {
          currentResults = [];
          currentIndex = -1;
          renderResults();
          return;
        }
        currentResults = response.results;
        currentIndex = 0;
        renderResults();
        chrome.tabs.sendMessage(tabId, {
          type: "SEMANTIC_JUMP_TO",
          id: currentResults[currentIndex].id
        });
      }
    );
  });
}

function debouncedSearch() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(sendSearch, 250);
}

function jumpToResult(idx) {
  if (!currentResults.length) return;
  currentIndex = ((idx % currentResults.length) + currentResults.length) % currentResults.length;
  renderResults();
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs[0].id;
    chrome.tabs.sendMessage(tabId, {
      type: "SEMANTIC_JUMP_TO",
      id: currentResults[currentIndex].id
    });
  });
}

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
