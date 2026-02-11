chrome.commands.onCommand.addListener((command) => {
  if (command === "open_semantic_find") {
    chrome.action.openPopup();
  }
});
