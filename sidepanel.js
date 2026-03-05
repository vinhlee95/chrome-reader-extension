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

const KNOWN_LANGUAGE_NAMES = {
  en: 'English',
  vi: 'Vietnamese',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese',
  th: 'Thai',
  ar: 'Arabic',
  ru: 'Russian',
  hi: 'Hindi'
};

const VIETNAMESE_CHAR_REGEX = /[\u0103\u00e2\u0111\u00ea\u00f4\u01a1\u01b0\u0102\u00c2\u0110\u00ca\u00d4\u01a0\u01af\u00e0\u00e1\u1ea1\u1ea3\u00e3\u1eb1\u1eaf\u1eb7\u1eb3\u1eb5\u1ea7\u1ea5\u1ead\u1ea9\u1eab\u00e8\u00e9\u1eb9\u1ebb\u1ebd\u1ec1\u1ebf\u1ec7\u1ec3\u1ec5\u00ec\u00ed\u1ecb\u1ec9\u0129\u00f2\u00f3\u1ecd\u1ecf\u00f5\u1ed3\u1ed1\u1ed9\u1ed5\u1ed7\u1edd\u1edb\u1ee3\u1edf\u1ee1\u00f9\u00fa\u1ee5\u1ee7\u0169\u1eeb\u1ee9\u1ef1\u1eed\u1eef\u1ef3\u00fd\u1ef5\u1ef7\u1ef9]/g;
const CJK_REGEX = /[\u4E00-\u9FFF]/g;
const HIRAGANA_KATAKANA_REGEX = /[\u3040-\u30FF]/g;
const HANGUL_REGEX = /[\uAC00-\uD7AF]/g;
const CYRILLIC_REGEX = /[\u0400-\u04FF]/g;
const THAI_REGEX = /[\u0E00-\u0E7F]/g;
const ARABIC_REGEX = /[\u0600-\u06FF]/g;
const DEVANAGARI_REGEX = /[\u0900-\u097F]/g;

const VIETNAMESE_WORDS = [' v\u00e0 ', ' c\u1ee7a ', ' kh\u00f4ng ', ' \u0111\u01b0\u1ee3c ', ' nh\u1eefng ', ' trong ', ' m\u1ed9t ', ' c\u00e1c ', ' \u0111\u1ec3 ', ' v\u1edbi ', ' n\u00e0y '];
const ENGLISH_WORDS = [' the ', ' and ', ' to ', ' of ', ' in ', ' is ', ' for ', ' on ', ' with ', ' that '];

function countMatches(text, regex) {
  if (!text) return 0;
  const matches = text.match(regex);
  return matches ? matches.length : 0;
}

function countWordHits(text, words) {
  if (!text) return 0;
  let total = 0;
  for (const word of words) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'g');
    total += countMatches(text, regex);
  }
  return total;
}

function normalizeLanguageCode(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const cleaned = raw.trim().toLowerCase().replace(/_/g, '-');
  if (!cleaned) return '';

  if (cleaned.startsWith('zh')) return 'zh';
  if (cleaned.startsWith('ja')) return 'ja';
  if (cleaned.startsWith('ko')) return 'ko';
  if (cleaned.startsWith('vi')) return 'vi';
  if (cleaned.startsWith('th')) return 'th';
  if (cleaned.startsWith('ar')) return 'ar';
  if (cleaned.startsWith('ru')) return 'ru';
  if (cleaned.startsWith('hi')) return 'hi';
  if (cleaned.startsWith('en')) return 'en';

  const shortCode = cleaned.split('-')[0];
  return shortCode || '';
}

function parseLanguageHint(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const firstToken = raw.split(',')[0].split(';')[0].trim();
  return normalizeLanguageCode(firstToken);
}

function languageDescriptor(code) {
  const normalized = normalizeLanguageCode(code) || 'en';
  return {
    code: normalized,
    name: KNOWN_LANGUAGE_NAMES[normalized] || normalized
  };
}

function extractLanguageHints(pageContent) {
  if (!pageContent) return [];
  const hints = [
    parseLanguageHint(pageContent.pageLang),
    parseLanguageHint(pageContent.metaContentLanguage),
    parseLanguageHint(pageContent.metaLanguage)
  ].filter(Boolean);

  return [...new Set(hints)];
}

function detectDominantLanguage(pageContent) {
  const title = pageContent?.title || '';
  const content = pageContent?.content || '';
  const sample = `${title}\n${content}`.slice(0, 20000);

  if (!sample.trim()) {
    return 'en';
  }

  const japaneseKanaCount = countMatches(sample, HIRAGANA_KATAKANA_REGEX);
  const cjkCount = countMatches(sample, CJK_REGEX);

  if (japaneseKanaCount > 0) return 'ja';
  if (countMatches(sample, HANGUL_REGEX) > 0) return 'ko';
  if (countMatches(sample, THAI_REGEX) > 0) return 'th';
  if (countMatches(sample, ARABIC_REGEX) > 0) return 'ar';
  if (countMatches(sample, CYRILLIC_REGEX) > 0) return 'ru';
  if (countMatches(sample, DEVANAGARI_REGEX) > 0) return 'hi';
  if (cjkCount > 0) return 'zh';

  const lowered = ` ${sample.toLowerCase()} `;
  const vietnameseScore = countMatches(sample, VIETNAMESE_CHAR_REGEX) + countWordHits(lowered, VIETNAMESE_WORDS);
  const englishScore = countWordHits(lowered, ENGLISH_WORDS);

  if (vietnameseScore > englishScore && vietnameseScore > 0) {
    return 'vi';
  }

  if (englishScore > 0 || /[a-z]/i.test(sample)) {
    return 'en';
  }

  return 'en';
}

function resolveTargetLanguage(tabId) {
  if (langMode === 'en') {
    return {
      mode: 'en',
      source: 'language-mode',
      ...languageDescriptor('en')
    };
  }

  const state = getTabState(tabId);
  const pageContent = state.pageContent;
  const hints = extractLanguageHints(pageContent);

  if (hints.length > 0) {
    return {
      mode: 'default',
      source: 'page-language-hint',
      ...languageDescriptor(hints[0])
    };
  }

  return {
    mode: 'default',
    source: 'dominant-content-detection',
    ...languageDescriptor(detectDominantLanguage(pageContent))
  };
}

function buildSuggestionModelText(promptText, languageContext) {
  if (langMode !== 'default') {
    return promptText;
  }

  return `[Internal language instruction: You must answer entirely in ${languageContext.name} (${languageContext.code}). Do not switch to English unless the target language is English.]\n\n${promptText}`;
}

function buildSystemPrompt(tabId, languageContext) {
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

  const langInstructions = `Language constraints (higher priority than style/tone):
- Language mode: ${languageContext.mode}
- Resolved target language: ${languageContext.name} (${languageContext.code})
- Output must be entirely in ${languageContext.name} (${languageContext.code}).
- Do not switch to English unless the resolved target language is English.
- If the user writes in another language, still answer in ${languageContext.name}.
- Keep unavoidable items unchanged (URLs, code, product names, proper nouns).
- Before finalizing, self-check language consistency and rewrite to ${languageContext.name} if needed.`;

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

async function handleSend(options = {}) {
  const inputText = typeof options.text === 'string' ? options.text : userInput.value;
  const text = inputText.trim();
  if (!text || isStreaming || isSending || typeof activeTabId !== 'number') return;
  isSending = true;

  const state = getTabState(activeTabId);
  const isSuggestion = options.isSuggestion === true;

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

  const applyIdeasRole = options.applyIdeasRole || null;

  const languageContext = resolveTargetLanguage(activeTabId);
  const modelUserText = applyIdeasRole
    ? `The user is a "${applyIdeasRole}". Based on the ideas, concepts, and insights from this article/page, provide specific, actionable ways they can apply these ideas in their role as a ${applyIdeasRole}. Tailor the advice to be practical and directly relevant to their day-to-day work. Use concrete examples where possible.`
    : isSuggestion
      ? buildSuggestionModelText(text, languageContext)
      : text;

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
  await streamResponse(openrouter_api_key, model, activeTabId, {
    modelUserText,
    languageContext
  });
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
        <button class="suggestion-btn" data-action="apply-ideas">Apply ideas to my role</button>
      </div>
    </div>
  `;

  attachSuggestionListeners(messagesEl);
}

function renderTabState(tabId) {
  pendingApplyIdeas = false;
  userInput.placeholder = 'Ask about this page...';

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
      if (btn.dataset.action === 'apply-ideas') {
        startApplyIdeasFlow();
        return;
      }
      const prompt = btn.dataset.prompt;
      handleSend({
        text: prompt,
        isSuggestion: true
      });
    });
  });
}

let pendingApplyIdeas = false;

const ROLE_OPTIONS = [
  'Engineering Manager',
  'Investor',
  'Software Engineer',
  'Product Manager',
  'Designer',
  'Data Scientist',
  'Marketing Manager',
  'Founder / CEO',
  'Accountant',
  'Teacher / Educator',
  'Student',
];

function startApplyIdeasFlow() {
  if (isStreaming || isSending || typeof activeTabId !== 'number') return;

  pendingApplyIdeas = true;

  // Hide welcome message
  const welcomeEl = messagesEl.querySelector('.welcome');
  if (welcomeEl) welcomeEl.remove();

  // Show the user's selection as a message
  addMessage('user', 'Apply ideas to my role');

  const state = getTabState(activeTabId);
  state.conversationHistory.push({ role: 'user', content: 'Apply ideas to my role' });

  // Show the bot's question with role picker
  const botQuestion = "What's your role or occupation?";
  const wrapper = addMessage('assistant', botQuestion, { showActions: false });

  const picker = document.createElement('div');
  picker.className = 'role-picker';
  picker.innerHTML = ROLE_OPTIONS.map(role =>
    `<button class="role-option-btn">${role}</button>`
  ).join('');

  const customRow = document.createElement('div');
  customRow.className = 'role-custom-row';
  customRow.innerHTML = `<input type="text" class="role-custom-input" placeholder="Or type your role..." /><button class="role-custom-submit" title="Submit">→</button>`;
  picker.appendChild(customRow);

  wrapper.appendChild(picker);
  scrollToBottom();

  // Handle role button clicks
  picker.querySelectorAll('.role-option-btn').forEach(btn => {
    btn.addEventListener('click', () => selectRole(btn.textContent, wrapper));
  });

  // Handle custom input
  const customInput = customRow.querySelector('.role-custom-input');
  const customSubmit = customRow.querySelector('.role-custom-submit');

  customSubmit.addEventListener('click', () => {
    const role = customInput.value.trim();
    if (role) selectRole(role, wrapper);
  });

  customInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const role = customInput.value.trim();
      if (role) selectRole(role, wrapper);
    }
  });

  customInput.focus();

  state.conversationHistory.push({ role: 'assistant', content: botQuestion });
}

function selectRole(role, pickerWrapper) {
  // Remove the picker from the message
  const picker = pickerWrapper.querySelector('.role-picker');
  if (picker) picker.remove();

  pendingApplyIdeas = false;

  handleSend({
    text: role,
    isSuggestion: false,
    applyIdeasRole: role
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

async function streamResponse(apiKey, model, tabId, requestOptions = {}) {
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
    const languageContext = requestOptions.languageContext || resolveTargetLanguage(tabId);
    const requestMessages = [
      { role: 'system', content: buildSystemPrompt(tabId, languageContext) },
      ...stateAtStart.conversationHistory
    ];

    if (requestOptions.modelUserText && requestMessages.length > 1) {
      const lastIndex = requestMessages.length - 1;
      if (requestMessages[lastIndex].role === 'user') {
        requestMessages[lastIndex] = {
          ...requestMessages[lastIndex],
          content: requestOptions.modelUserText
        };
      }
    }

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
        messages: requestMessages,
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
