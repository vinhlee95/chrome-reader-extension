// State
let conversationHistory = [];
let isStreaming = false;
let pageContent = null;
let currentPageUrl = null;

// DOM refs
const messagesEl = document.getElementById('messages');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const settingsBtn = document.getElementById('settings-btn');
const bannerSettingsBtn = document.getElementById('banner-settings-btn');
const apiKeyBanner = document.getElementById('api-key-banner');
const pageContextEl = document.getElementById('page-context');
const pageTitleEl = document.getElementById('page-title');

// Max conversation messages to keep (rolling window)
const MAX_HISTORY = 20;

// Theme
const themeToggle = document.getElementById('theme-toggle');
const themeIcons = {
  system: document.getElementById('theme-icon-system'),
  light: document.getElementById('theme-icon-light'),
  dark: document.getElementById('theme-icon-dark'),
};
const themeCycle = ['system', 'light', 'dark'];
let currentTheme = 'system';

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

// Init
document.addEventListener('DOMContentLoaded', init);

async function init() {
  // Load and apply theme
  const { theme_preference } = await chrome.storage.local.get(['theme_preference']);
  applyTheme(theme_preference || 'system');

  checkApiKey();
  await fetchPageContent();
  setupEventListeners();
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

  // Settings buttons
  settingsBtn.addEventListener('click', openSettings);
  bannerSettingsBtn.addEventListener('click', openSettings);

  // Suggestion buttons
  document.querySelectorAll('.suggestion-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const prompt = btn.dataset.prompt;
      userInput.value = prompt;
      handleSend();
    });
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

async function fetchPageContent() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_PAGE_CONTENT' });

    if (response.error) {
      showError(response.error);
      return;
    }

    pageContent = response;
    currentPageUrl = response.url;

    // Show page context
    pageTitleEl.textContent = response.title || 'Untitled page';
    pageContextEl.classList.remove('hidden');
  } catch (err) {
    showError('Could not connect to the page. Try refreshing.');
  }
}

function buildSystemPrompt() {
  if (!pageContent) {
    return 'You are a helpful assistant. The user wanted to ask about a webpage, but the content could not be loaded.';
  }

  return `You are a helpful assistant that answers questions about web pages. You have access to the following page content:

**Page Title:** ${pageContent.title}
**Page URL:** ${pageContent.url}

**Page Content:**
${pageContent.content}

Instructions:
- Answer the user's questions based on the page content above.
- Be concise and helpful.
- If the answer isn't in the page content, say so.
- Use markdown formatting for readability.`;
}

async function handleSend() {
  const text = userInput.value.trim();
  if (!text || isStreaming) return;

  // Check for API key
  const { openrouter_api_key, openrouter_model } = await chrome.storage.local.get(['openrouter_api_key', 'openrouter_model']);

  if (!openrouter_api_key) {
    apiKeyBanner.classList.remove('hidden');
    return;
  }

  // Re-fetch content if not yet loaded or URL changed
  try {
    const freshContent = await chrome.runtime.sendMessage({ type: 'GET_PAGE_CONTENT' });
    if (freshContent && !freshContent.error) {
      if (freshContent.url !== currentPageUrl) {
        // New page — reset conversation
        conversationHistory = [];
      }
      if (!pageContent || freshContent.url !== currentPageUrl) {
        pageContent = freshContent;
        currentPageUrl = freshContent.url;
        pageTitleEl.textContent = freshContent.title || 'Untitled page';
        pageContextEl.classList.remove('hidden');
      }
    }
  } catch (e) {
    // Continue with cached content
  }

  // Hide welcome message
  const welcomeEl = messagesEl.querySelector('.welcome');
  if (welcomeEl) welcomeEl.remove();

  // Add user message
  addMessage('user', text);
  conversationHistory.push({ role: 'user', content: text });

  // Trim conversation history
  if (conversationHistory.length > MAX_HISTORY) {
    conversationHistory = conversationHistory.slice(-MAX_HISTORY);
  }

  // Clear input
  userInput.value = '';
  userInput.style.height = 'auto';

  // Stream response
  const model = openrouter_model || 'anthropic/claude-sonnet-4';
  await streamResponse(openrouter_api_key, model);
}

function addMessage(role, content) {
  const div = document.createElement('div');
  div.className = `message ${role}`;

  if (role === 'assistant') {
    div.innerHTML = renderMarkdown(content);
  } else {
    div.textContent = content;
  }

  messagesEl.appendChild(div);
  scrollToBottom();
  return div;
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

async function streamResponse(apiKey, model) {
  isStreaming = true;
  sendBtn.disabled = true;

  const assistantDiv = addMessage('assistant', '');
  assistantDiv.classList.add('streaming');

  let fullContent = '';

  try {
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
          { role: 'system', content: buildSystemPrompt() },
          ...conversationHistory
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
            assistantDiv.innerHTML = renderMarkdown(fullContent);
            scrollToBottom();
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
    assistantDiv.innerHTML = renderMarkdown(fullContent);
    assistantDiv.classList.remove('streaming');

    // Add to conversation history
    conversationHistory.push({ role: 'assistant', content: fullContent });

  } catch (err) {
    assistantDiv.remove();
    showError(err.message);
  } finally {
    isStreaming = false;
    sendBtn.disabled = false;
    userInput.focus();
  }
}
