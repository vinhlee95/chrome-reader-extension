// State
const tabStates = new Map();
let activeTabId = null;
let isStreaming = false;
let streamingTabId = null;

// DOM refs
const messagesEl = document.getElementById('messages');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const settingsBtn = document.getElementById('settings-btn');
const bannerSettingsBtn = document.getElementById('banner-settings-btn');
const apiKeyBanner = document.getElementById('api-key-banner');
const pageTitleEl = document.getElementById('page-title');
const toneBtn = document.getElementById('tone-btn');
const toneLabel = document.getElementById('tone-label');
const toneSelector = document.getElementById('tone-selector');
const toneDropdown = document.getElementById('tone-dropdown');
const langBtn = document.getElementById('lang-btn');
const langLabel = document.getElementById('lang-label');
const langSelector = document.getElementById('lang-selector');
const langDropdown = document.getElementById('lang-dropdown');

// Max conversation messages to keep (rolling window)
const MAX_HISTORY = 100;

// Theme
const themeToggle = document.getElementById('theme-toggle');
const themeIcons = {
  system: document.getElementById('theme-icon-system'),
  light: document.getElementById('theme-icon-light'),
  dark: document.getElementById('theme-icon-dark'),
};
const themeCycle = ['system', 'light', 'dark'];
let currentTheme = 'system';
let toneMode = 'chill';
let langMode = 'default';
let lastUsedModel = '';

function createDefaultTabState() {
  return {
    conversationHistory: [],
    pageContent: null,
    currentPageUrl: null
  };
}

function getTabState(tabId) {
  if (typeof tabId !== 'number') {
    return createDefaultTabState();
  }

  if (!tabStates.has(tabId)) {
    tabStates.set(tabId, createDefaultTabState());
  }

  return tabStates.get(tabId);
}

function clearTabState(tabId) {
  tabStates.delete(tabId);
}

function applyTheme(theme) {
  currentTheme = theme;
  if (theme === 'system') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
  Object.values(themeIcons).forEach(icon => icon.classList.add('hidden'));
  themeIcons[theme].classList.remove('hidden');
}

function cycleTheme() {
  const nextIndex = (themeCycle.indexOf(currentTheme) + 1) % themeCycle.length;
  const next = themeCycle[nextIndex];
  applyTheme(next);
  chrome.storage.local.set({ theme_preference: next });
}

const toneModeLabels = { chill: 'Chill', normal: 'Normal' };
const langModeLabels = { default: 'Default', en: 'English' };

function applyToneMode(mode) {
  toneMode = mode;
  toneLabel.textContent = toneModeLabels[mode] || mode;
  toneDropdown.querySelectorAll('.mode-option').forEach(opt => {
    opt.classList.toggle('selected', opt.dataset.value === mode);
  });
}

function applyLangMode(mode) {
  langMode = mode;
  langLabel.textContent = langModeLabels[mode] || mode;
  langDropdown.querySelectorAll('.mode-option').forEach(opt => {
    opt.classList.toggle('selected', opt.dataset.value === mode);
  });
}

function toggleDropdown(selector) {
  const isOpen = selector.classList.contains('open');
  // Close all dropdowns first
  document.querySelectorAll('.mode-selector.open').forEach(s => s.classList.remove('open'));
  if (!isOpen) selector.classList.add('open');
}

function closeAllDropdowns() {
  document.querySelectorAll('.mode-selector.open').forEach(s => s.classList.remove('open'));
}

// Init
document.addEventListener('DOMContentLoaded', init);

async function init() {
  // Load and apply theme
  const { theme_preference, tone_mode, chilllax_mode, lang_mode } = await chrome.storage.local.get(['theme_preference', 'tone_mode', 'chilllax_mode', 'lang_mode']);
  applyTheme(theme_preference || 'system');
  // Migrate old chilllax_mode to new tone_mode
  if (tone_mode) {
    applyToneMode(tone_mode);
  } else {
    applyToneMode(chilllax_mode !== false ? 'chill' : 'normal');
  }
  applyLangMode(lang_mode || 'default');

  setupEventListeners();

  const activeTabResponse = await chrome.runtime.sendMessage({ type: 'GET_ACTIVE_TAB_ID' }).catch(() => ({ error: 'No active tab found' }));
  if (activeTabResponse && !activeTabResponse.error && typeof activeTabResponse.tabId === 'number') {
    activeTabId = activeTabResponse.tabId;
    getTabState(activeTabId);
    await fetchPageContent(activeTabId);
    renderTabState(activeTabId);
  } else {
    renderTabState(null);
    if (activeTabResponse?.error) {
      showError(activeTabResponse.error);
    }
  }

  checkApiKey();
}

function setupEventListeners() {
  sendBtn.addEventListener('click', handleSend);

  userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  // Auto-resize textarea
  userInput.addEventListener('input', () => {
    userInput.style.height = 'auto';
    userInput.style.height = Math.min(userInput.scrollHeight, 130) + 'px';
  });

  // Theme toggle
  themeToggle.addEventListener('click', cycleTheme);

  // Custom dropdown toggles
  toneBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDropdown(toneSelector);
  });
  langBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDropdown(langSelector);
  });

  // Dropdown option clicks
  toneDropdown.addEventListener('click', (e) => {
    const opt = e.target.closest('.mode-option');
    if (!opt) return;
    applyToneMode(opt.dataset.value);
    chrome.storage.local.set({ tone_mode: opt.dataset.value });
    closeAllDropdowns();
  });
  langDropdown.addEventListener('click', (e) => {
    const opt = e.target.closest('.mode-option');
    if (!opt) return;
    applyLangMode(opt.dataset.value);
    chrome.storage.local.set({ lang_mode: opt.dataset.value });
    closeAllDropdowns();
  });

  // Close dropdowns on outside click
  document.addEventListener('click', closeAllDropdowns);

  // Settings buttons
  settingsBtn.addEventListener('click', openSettings);
  bannerSettingsBtn.addEventListener('click', openSettings);

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'TAB_ACTIVATED' && typeof message.tabId === 'number') {
      switchToTab(message.tabId);
      return;
    }

    if (message.type === 'TAB_REMOVED' && typeof message.tabId === 'number') {
      clearTabState(message.tabId);

      if (streamingTabId === message.tabId) {
        streamingTabId = null;
      }

      if (activeTabId === message.tabId) {
        chrome.runtime.sendMessage({ type: 'GET_ACTIVE_TAB_ID' })
          .then((response) => {
            if (response && !response.error && typeof response.tabId === 'number') {
              switchToTab(response.tabId);
            } else {
              activeTabId = null;
              renderTabState(null);
            }
          })
          .catch(() => {
            activeTabId = null;
            renderTabState(null);
          });
      }
      return;
    }

    if (message.type === 'TAB_UPDATED' && typeof message.tabId === 'number') {
      const tabId = message.tabId;
      const shouldTrackTab = tabId === activeTabId || tabStates.has(tabId);
      if (!shouldTrackTab) {
        return;
      }

      const state = getTabState(tabId);

      if (typeof message.url === 'string' && state.currentPageUrl && message.url !== state.currentPageUrl) {
        tabStates.set(tabId, createDefaultTabState());
        if (tabId === activeTabId) {
          renderTabState(tabId);
        }
      }

      if (message.status === 'complete' && tabId === activeTabId && !isStreaming) {
        fetchPageContent(tabId).then(() => {
          renderTabState(tabId);
        });
      }
    }
  });
}

function openSettings() {
  chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') });
}

function checkApiKey() {
  chrome.storage.local.get(['openrouter_api_key'], (result) => {
    if (!result.openrouter_api_key) {
      apiKeyBanner.classList.remove('hidden');
    } else {
      apiKeyBanner.classList.add('hidden');
    }
  });
}

async function switchToTab(tabId) {
  if (typeof tabId !== 'number') {
    return;
  }

  activeTabId = tabId;
  const state = getTabState(tabId);
  renderTabState(tabId);

  if (!state.pageContent) {
    await fetchPageContent(tabId);
    renderTabState(tabId);
  }
}

async function fetchPageContent(tabId = activeTabId) {
  if (typeof tabId !== 'number') {
    return;
  }

  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_PAGE_CONTENT', tabId });

    const state = getTabState(tabId);

    if (response.error) {
      if (tabId === activeTabId) {
        showError(response.error);
      }
      return;
    }

    state.pageContent = response;
    state.currentPageUrl = response.url;

    if (tabId === activeTabId) {
      const title = response.title || 'Untitled page';
      pageTitleEl.textContent = title;
      document.title = title;
    }
  } catch (err) {
    if (tabId === activeTabId) {
      showError('Could not connect to the page. Try refreshing.');
    }
  }
}

function buildSystemPrompt(tabId) {
  const state = getTabState(tabId);
  const toneInstructions = toneMode === 'chill'
    ? `Tone instructions:
- Respond with a casual Gen Z vibe.
- Use emojis frequently to keep the vibe playful and expressive.
- Use slang naturally and keep the tone chill, casual, and less serious.
- Keep responses clear and accurate while sounding friendly and fun.`
    : `Tone instructions:
- Use a neutral, professional tone.
- Do not force slang or any specific style.`;

  const langInstructions = langMode === 'en'
    ? `Language: Always respond in English, regardless of the webpage's language.`
    : `Language: You MUST respond in the same language as the webpage content, even if the user's question is in a different language. Detect the language of the page content and always use that language in your response. For example, if the page is in Vietnamese, respond in Vietnamese even if the user asks in English.`;

  if (!state.pageContent) {
    return `You are a helpful assistant. The user wanted to ask about a webpage, but the content could not be loaded.

${toneInstructions}

${langInstructions}`;
  }

  return `You are a helpful assistant that answers questions about web pages. You have access to the following page content:

**Page Title:** ${state.pageContent.title}
**Page URL:** ${state.pageContent.url}

**Page Content:**
${state.pageContent.content}

Instructions:
- Prioritize answering from the page content above when relevant.
- Be concise and helpful.
- If the page content does not contain key information needed to answer, use your general knowledge to provide the best answer.
- When you use general knowledge, briefly note that the detail was not found in the page content.
- Use markdown formatting for readability.

${toneInstructions}

${langInstructions}`;
}

let isSending = false;

async function handleSend() {
  const text = userInput.value.trim();
  if (!text || isStreaming || isSending || typeof activeTabId !== 'number') return;
  isSending = true;

  const state = getTabState(activeTabId);

  // Check for API key
  const { openrouter_api_key, openrouter_model } = await chrome.storage.local.get(['openrouter_api_key', 'openrouter_model']);

  if (!openrouter_api_key) {
    apiKeyBanner.classList.remove('hidden');
    isSending = false;
    return;
  }

  // Re-fetch content for this tab and reset conversation if URL changed
  try {
    const freshContent = await chrome.runtime.sendMessage({ type: 'GET_PAGE_CONTENT', tabId: activeTabId });
    if (freshContent && !freshContent.error) {
      if (freshContent.url !== state.currentPageUrl) {
        state.conversationHistory = [];
        renderTabState(activeTabId);
      }

      state.pageContent = freshContent;
      state.currentPageUrl = freshContent.url;

      const freshTitle = freshContent.title || 'Untitled page';
      pageTitleEl.textContent = freshTitle;
      document.title = freshTitle;
    }
  } catch (e) {
    // Continue with cached content
  }

  // Hide welcome message
  const welcomeEl = messagesEl.querySelector('.welcome');
  if (welcomeEl) welcomeEl.remove();

  // Add user message
  addMessage('user', text);
  state.conversationHistory.push({ role: 'user', content: text });

  // Trim conversation history
  if (state.conversationHistory.length > MAX_HISTORY) {
    state.conversationHistory = state.conversationHistory.slice(-MAX_HISTORY);
  }

  // Clear input
  userInput.value = '';
  userInput.style.height = 'auto';

  // Stream response
  const model = openrouter_model || 'google/gemini-2.5-flash';
  lastUsedModel = model;
  isSending = false;
  await streamResponse(openrouter_api_key, model, activeTabId);
}

function addMessage(role, content, { showActions = true } = {}) {
  const wrapper = document.createElement('div');
  wrapper.className = `message-wrapper ${role}`;

  if (role === 'user') {
    const row = document.createElement('div');
    row.className = 'user-message-row';

    const actions = document.createElement('div');
    actions.className = 'user-message-actions';
    actions.innerHTML = `
      <button title="Copy" data-action="copy-user">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2"/>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
      </button>
    `;

    const bubble = document.createElement('div');
    bubble.className = 'message-content';
    bubble.textContent = content;

    row.appendChild(actions);
    row.appendChild(bubble);
    wrapper.appendChild(row);

    // Copy user message
    actions.querySelector('[data-action="copy-user"]').addEventListener('click', () => {
      navigator.clipboard.writeText(content);
    });

  } else if (role === 'assistant') {
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    contentDiv.innerHTML = renderMarkdown(content);
    wrapper.appendChild(contentDiv);

    if (showActions && content) {
      wrapper.appendChild(createAssistantActions(content, lastUsedModel));
    }
  }

  messagesEl.appendChild(wrapper);
  scrollToBottom();
  return wrapper;
}

function formatModelName(model) {
  // "anthropic/claude-sonnet-4" → "Claude Sonnet 4"
  const name = model.includes('/') ? model.split('/').pop() : model;
  return name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function createAssistantActions(rawContent, modelName) {
  const actions = document.createElement('div');
  actions.className = 'message-actions';

  const displayModel = modelName ? formatModelName(modelName) : '';

  actions.innerHTML = `
    <div class="message-actions-left">
      <button title="Copy" data-action="copy">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2"/>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
      </button>
    </div>
    ${displayModel ? `<span class="message-model">${displayModel}</span>` : ''}
  `;

  actions.querySelector('[data-action="copy"]').addEventListener('click', () => {
    navigator.clipboard.writeText(rawContent);
  });

  return actions;
}

function showError(text) {
  const div = document.createElement('div');
  div.className = 'message error';
  div.textContent = text;
  messagesEl.appendChild(div);
  scrollToBottom();
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderWelcome() {
  messagesEl.innerHTML = `
    <div class="welcome">
      <p>Ask me anything about the current page.</p>
      <div class="suggestions">
        <button class="suggestion-btn" data-prompt="Summarize this page">Summarize this page</button>
        <button class="suggestion-btn" data-prompt="What are the key points?">What are the key points?</button>
        <button class="suggestion-btn" data-prompt="Explain in simple terms">Explain in simple terms</button>
      </div>
    </div>
  `;

  attachSuggestionListeners(messagesEl);
}

function renderTabState(tabId) {
  if (typeof tabId !== 'number') {
    messagesEl.innerHTML = '';
    renderWelcome();
    pageTitleEl.textContent = 'Chrome Reader';
    document.title = 'Chrome Reader';
    return;
  }

  const state = getTabState(tabId);
  messagesEl.innerHTML = '';

  if (!state.conversationHistory.length) {
    renderWelcome();
  } else {
    for (const message of state.conversationHistory) {
      addMessage(message.role, message.content);
    }
  }

  const title = state.pageContent?.title || 'Chrome Reader';
  pageTitleEl.textContent = title;
  document.title = title;
}

function attachSuggestionListeners(root = document) {
  root.querySelectorAll('.suggestion-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const prompt = btn.dataset.prompt;
      userInput.value = prompt;
      handleSend();
    });
  });
}

function renderMarkdown(text) {
  if (typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
    return DOMPurify.sanitize(marked.parse(text));
  }
  // Fallback: escape HTML and convert newlines
  return escapeHtml(text).replace(/\n/g, '<br>');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function streamResponse(apiKey, model, tabId) {
  isStreaming = true;
  streamingTabId = tabId;
  sendBtn.disabled = true;

  const shouldRenderStream = activeTabId === tabId;
  const assistantWrapper = shouldRenderStream ? addMessage('assistant', '', { showActions: false }) : null;
  const assistantDiv = assistantWrapper ? assistantWrapper.querySelector('.message-content') : null;
  if (assistantDiv) {
    assistantDiv.classList.add('streaming');
  }

  let fullContent = '';

  try {
    const stateAtStart = getTabState(tabId);

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'chrome-extension://chrome-reader',
        'X-Title': 'Chrome Reader'
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: buildSystemPrompt(tabId) },
          ...stateAtStart.conversationHistory
        ],
        stream: true
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      if (response.status === 401) {
        throw new Error('Invalid API key. Check your key in settings.');
      } else if (response.status === 429) {
        throw new Error('Rate limited. Wait a moment and try again.');
      } else if (response.status === 402) {
        throw new Error('Insufficient credits. Add funds at openrouter.ai.');
      } else {
        throw new Error(errorData.error?.message || `API error (${response.status})`);
      }
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process SSE lines
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Keep incomplete line in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (!trimmed.startsWith('data: ')) continue;

        try {
          const json = JSON.parse(trimmed.slice(6));
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            fullContent += delta;
            if (assistantDiv && activeTabId === tabId) {
              assistantDiv.innerHTML = renderMarkdown(fullContent);
              scrollToBottom();
            }
          }
        } catch (e) {
          // Skip malformed JSON chunks
        }
      }
    }

    // Process any remaining buffer
    if (buffer.trim() && buffer.trim() !== 'data: [DONE]' && buffer.trim().startsWith('data: ')) {
      try {
        const json = JSON.parse(buffer.trim().slice(6));
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) {
          fullContent += delta;
        }
      } catch (e) {
        // Ignore
      }
    }

    // Final render
    if (assistantDiv && activeTabId === tabId) {
      assistantDiv.innerHTML = renderMarkdown(fullContent);
      assistantDiv.classList.remove('streaming');
    }

    // Add action bar after streaming completes
    if (assistantWrapper && activeTabId === tabId && fullContent) {
      assistantWrapper.appendChild(createAssistantActions(fullContent, model));
    }

    // Add to conversation history if tab still exists
    if (tabStates.has(tabId)) {
      const state = getTabState(tabId);
      state.conversationHistory.push({ role: 'assistant', content: fullContent });
      if (state.conversationHistory.length > MAX_HISTORY) {
        state.conversationHistory = state.conversationHistory.slice(-MAX_HISTORY);
      }
    }

  } catch (err) {
    if (assistantWrapper) {
      assistantWrapper.remove();
    }
    if (activeTabId === tabId) {
      showError(err.message);
    }
  } finally {
    isStreaming = false;
    streamingTabId = null;
    sendBtn.disabled = false;
    userInput.focus();
  }
}
