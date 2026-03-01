// Apply theme
chrome.storage.local.get(['theme_preference'], (result) => {
  const theme = result.theme_preference || 'system';
  if (theme !== 'system') {
    document.documentElement.setAttribute('data-theme', theme);
  }
});

const apiKeyInput = document.getElementById('api-key');
const toggleBtn = document.getElementById('toggle-visibility');
const modelSelect = document.getElementById('model-select');
const saveBtn = document.getElementById('save-btn');
const saveStatus = document.getElementById('save-status');
const keyStatus = document.getElementById('key-status');

// Load saved settings
chrome.storage.local.get(['openrouter_api_key', 'openrouter_model'], (result) => {
  if (result.openrouter_api_key) {
    // Show masked version of the key
    const key = result.openrouter_api_key;
    const masked = 'sk-or-...' + key.slice(-4);
    apiKeyInput.placeholder = masked;
    keyStatus.textContent = 'Key saved (showing last 4 chars)';
    keyStatus.className = 'status success';
    keyStatus.classList.remove('hidden');
  }

  if (result.openrouter_model) {
    modelSelect.value = result.openrouter_model;
  }
});

// Toggle API key visibility
toggleBtn.addEventListener('click', () => {
  const isPassword = apiKeyInput.type === 'password';
  apiKeyInput.type = isPassword ? 'text' : 'password';
});

// Save settings
saveBtn.addEventListener('click', () => {
  const data = {};

  // Only update API key if user typed something new
  if (apiKeyInput.value.trim()) {
    data.openrouter_api_key = apiKeyInput.value.trim();
  }

  data.openrouter_model = modelSelect.value;

  chrome.storage.local.set(data, () => {
    saveStatus.textContent = 'Settings saved!';
    saveStatus.className = 'status success';
    saveStatus.classList.remove('hidden');

    if (data.openrouter_api_key) {
      const masked = 'sk-or-...' + data.openrouter_api_key.slice(-4);
      apiKeyInput.value = '';
      apiKeyInput.placeholder = masked;
      keyStatus.textContent = 'Key saved (showing last 4 chars)';
      keyStatus.className = 'status success';
      keyStatus.classList.remove('hidden');
    }

    setTimeout(() => {
      saveStatus.classList.add('hidden');
    }, 3000);
  });
});
