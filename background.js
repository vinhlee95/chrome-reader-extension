const OPEN_PANEL_TABS_KEY = 'open_panel_tabs';
const openPanelTabs = new Set();

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
chrome.sidePanel.setOptions({ path: 'sidepanel.html', enabled: false }).catch(() => {});
void initPanelState();

async function initPanelState() {
  try {
    const data = await chrome.storage.session.get([OPEN_PANEL_TABS_KEY]);
    const savedTabs = data[OPEN_PANEL_TABS_KEY];
    if (Array.isArray(savedTabs)) {
      for (const tabId of savedTabs) {
        if (typeof tabId === 'number') {
          openPanelTabs.add(tabId);
        }
      }
    }
  } catch (err) {
    // Ignore storage restore failures and continue with empty state.
  }

  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (activeTab && typeof activeTab.id === 'number') {
    await applyPanelOptionForTab(activeTab.id);
  }
}

function persistOpenPanelTabs() {
  return chrome.storage.session.set({
    [OPEN_PANEL_TABS_KEY]: Array.from(openPanelTabs)
  });
}

function applyPanelOptionForTab(tabId) {
  const enabled = openPanelTabs.has(tabId);
  const options = enabled
    ? { tabId, path: 'sidepanel.html', enabled: true }
    : { tabId, enabled: false };
  return chrome.sidePanel.setOptions(options).catch(() => {});
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || typeof tab.id !== 'number') {
    return;
  }

  const tabId = tab.id;
  if (openPanelTabs.has(tabId)) {
    openPanelTabs.delete(tabId);
  } else {
    openPanelTabs.add(tabId);
  }

  try {
    await persistOpenPanelTabs();
  } catch (err) {
    // Ignore persistence failures in-session.
  }

  await applyPanelOptionForTab(tabId);
});

// Listen for messages from the side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'GET_PAGE_CONTENT':
      getPageContent(message.tabId).then(sendResponse).catch(err => {
        sendResponse({ error: err.message });
      });
      return true; // Keep message channel open for async response
    case 'GET_ACTIVE_TAB_ID':
      getActiveTabId().then(sendResponse).catch(err => {
        sendResponse({ error: err.message });
      });
      return true;
    default:
      return false;
  }
});

function notifySidepanel(message) {
  chrome.runtime.sendMessage(message).catch(() => {
    // No receiving sidepanel is normal if it is currently closed.
  });
}

chrome.tabs.onActivated.addListener(({ tabId }) => {
  applyPanelOptionForTab(tabId);
  notifySidepanel({ type: 'TAB_ACTIVATED', tabId });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (openPanelTabs.delete(tabId)) {
    persistOpenPanelTabs().catch(() => {});
  }
  notifySidepanel({ type: 'TAB_REMOVED', tabId });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status || changeInfo.url) {
    notifySidepanel({
      type: 'TAB_UPDATED',
      tabId,
      status: changeInfo.status,
      url: changeInfo.url
    });
  }
});

async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab || typeof tab.id !== 'number') {
    return { error: 'No active tab found' };
  }
  return { tabId: tab.id };
}

async function getPageContent(tabId) {
  let tab;
  if (typeof tabId === 'number') {
    tab = await chrome.tabs.get(tabId).catch(() => null);
  } else {
    [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  }

  if (!tab) {
    return { error: 'No tab found' };
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
