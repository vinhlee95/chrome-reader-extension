// Open side panel when extension icon is clicked
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Listen for messages from the side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_PAGE_CONTENT') {
    getPageContent().then(sendResponse).catch(err => {
      sendResponse({ error: err.message });
    });
    return true; // Keep message channel open for async response
  }
});

async function getPageContent() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });

  if (!tab) {
    return { error: 'No active tab found' };
  }

  if (!tab.url) {
    return { error: 'Cannot access tab URL. Try refreshing the page.' };
  }

  // Guard against chrome:// and other restricted pages
  if (
    tab.url.startsWith('chrome://') ||
    tab.url.startsWith('chrome-extension://') ||
    tab.url.startsWith('about:') ||
    tab.url.startsWith('edge://') ||
    tab.url.startsWith('brave://')
  ) {
    return {
      error: 'Cannot read content from browser internal pages. Navigate to a regular webpage to use Chrome Reader.'
    };
  }

  // Detect PDF pages
  if (tab.url.endsWith('.pdf') || tab.url.includes('.pdf?')) {
    return {
      error: 'PDF pages are not supported yet. Chrome Reader works best with regular web pages.'
    };
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        return {
          title: document.title,
          url: location.href,
          content: document.body.innerText
        };
      }
    });

    if (results && results[0] && results[0].result) {
      const data = results[0].result;
      // Truncate content to 30,000 chars
      if (data.content && data.content.length > 30000) {
        data.content = data.content.substring(0, 30000) + '\n\n[Content truncated — showing first 30,000 characters]';
      }
      return data;
    }

    return { error: 'Could not extract page content' };
  } catch (err) {
    return { error: 'Failed to read page content: ' + err.message };
  }
}
