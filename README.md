# Chrome Reader

A Chrome side panel extension that lets you chat with AI about any webpage you're viewing. Ask questions, get summaries, and understand content — all in context.

## Features

- **Side Panel Chat** — Clean, minimal chat UI that lives in Chrome's side panel
- **Per-Tab Conversations** — Each tab gets its own independent chat history and page context
- **Multiple AI Models** — Supports Gemini 2.5 Flash (default), Claude Sonnet/Haiku, GPT-4o, and more via OpenRouter
- **Tone Modes** — Switch between chill (casual) and normal (professional) response styles
- **Language Selection** — Default or English-only responses
- **Dark/Light/System Theme** — Adapts to your preference
- **Streaming Responses** — Real-time AI responses with markdown rendering
- **Quick Suggestions** — One-click prompts like "Summarize this page" and "What are the key points?"

## Setup

1. Clone this repo
2. Go to `chrome://extensions` and enable Developer Mode
3. Click "Load unpacked" and select this folder
4. Click the extension icon and open Settings to add your [OpenRouter API key](https://openrouter.ai/)
5. Open the side panel on any webpage and start chatting

## Tech Stack

Pure vanilla HTML/CSS/JS — no build tools, no framework, no dependencies to install. Just load and go.

- Chrome Extensions Manifest V3
- OpenRouter API for LLM access
- [marked.js](https://github.com/markedjs/marked) for markdown rendering
- [DOMPurify](https://github.com/cure53/DOMPurify) for HTML sanitization
