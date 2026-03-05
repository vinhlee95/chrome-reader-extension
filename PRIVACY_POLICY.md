# Privacy Policy — Chrome Reader

_Last updated: March 2026_

## Overview

Chrome Reader is a browser extension that lets you chat with AI about any webpage you are viewing. This policy explains what data the extension accesses, how it is used, and what is never collected.

---

## Data Collected and How It Is Used

### 1. OpenRouter API Key
- **What:** The API key you provide in the extension settings.
- **Where it is stored:** Locally on your device using Chrome's `chrome.storage.local` API. It is never transmitted to anyone other than OpenRouter, and only as an authorization header when you initiate a chat.
- **Who can access it:** Only you, via Chrome's storage. The extension developer has no access.

### 2. Webpage Content
- **What:** When you send a message in the chat panel, the visible text content of the active webpage (`document.body.innerText`) is extracted and included as context in the request sent to OpenRouter.
- **Why:** So the AI can answer questions about the page you are viewing.
- **Where it goes:** Directly from your browser to OpenRouter's API (`https://openrouter.ai/api/v1/chat/completions`). It is not sent to the extension developer or any other party.

### 3. Conversation History
- **What:** Messages you send and AI responses are kept in memory for the duration of your browser session, scoped per browser tab.
- **Persistence:** Conversation history is **not** saved to disk and is cleared when you close the tab or browser. Nothing is written to `chrome.storage`.

---

## What Is Never Collected

- No analytics, telemetry, or usage tracking of any kind.
- No personal identifiers (name, email, IP address).
- No browsing history beyond the single active page you are currently chatting about.
- No data is ever sent to the extension developer.

---

## Third-Party Services

Webpage content and your messages are sent to **OpenRouter** for AI processing. OpenRouter's privacy practices are governed by their own policy:
[https://openrouter.ai/privacy](https://openrouter.ai/privacy)

The specific AI model that processes your data depends on the model you select in extension settings (e.g., Google Gemini, Anthropic Claude, OpenAI GPT-4o). Each model provider has its own data handling terms, accessible through OpenRouter.

---

## How to Delete Your Data

To remove all data stored by Chrome Reader:
1. Open Chrome and go to `chrome://extensions/`
2. Find **Chrome Reader** and click **Details**
3. Click **Clear data** (or remove the extension entirely)

This deletes your stored API key and any extension settings.

---

## Changes to This Policy

If this policy changes, the updated version will be published in the extension's GitHub repository. Continued use of the extension after changes are posted constitutes acceptance of the updated policy.

---

## Contact

For privacy questions or concerns, please [open an issue](https://github.com/vinhlee95/chrome-reader-extension/issues) on the GitHub repository.
