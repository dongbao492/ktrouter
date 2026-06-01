# KTRouter

[![npm version](https://img.shields.io/npm/v/ktrouter.svg)](https://www.npmjs.com/package/ktrouter)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**KTRouter** is a lightweight, local AI proxy router designed for developers. It sits between your local coding assistants (such as Claude Code, Codex, Cline, Cursor, or Copilot) and AI providers (OpenAI, Anthropic, Gemini, DeepSeek, Vertex AI, OpenRouter, etc.), giving you a unified, OpenAI-compatible API endpoint, robust traffic routing, and deep inspection features.

It comes equipped with both a sleek **Next.js Web Dashboard** and a fully interactive **Terminal UI (TUI)**, alongside background **System Tray** integration.

---

## 🌟 Key Features

- 🔀 **Unified API Router:** Exposes a single, local OpenAI-compatible API endpoint (`http://localhost:3008/v1`) that dynamically translates request formats and routes them to your desired AI providers.
- 🔌 **Seamless Dev-Tool Integration:** Auto-configures and integrates natively with popular tools like **Claude Code, Codex, Cline, Cursor, Copilot, OpenCode, OpenClaw, Hermes, and jcode**.
- 🖥️ **Dual Interface:**
  - **Web Dashboard:** A modern, clean web interface with dark mode, live charts, usage tracking, credential managers, and visual tool configuration.
  - **Terminal UI (TUI):** A fully-featured interactive terminal application for SSH/headless environments.
- 🛡️ **MITM DNS Redirection & Proxy:** Intercepts outgoing requests from local CLI agents (such as routing `api.anthropic.com` traffic for Claude Code locally to KTRouter) using automatic DNS configurations and dynamically generated TLS certificates.
- 📥 **Background Tray Mode:** Hide to system tray (using native Windows NotifyIcon and macOS/Linux `systray2`) to run silently in the background on startup.
- 📦 **Zero-Configuration & Self-Healing:** Self-heals its SQLite database and native dependencies (`better-sqlite3`, `systray2`) at runtime into user directories (`~/.ktrouter` or `%APPDATA%/ktrouter`), ensuring hassle-free global CLI updates.

---

## 🔄 How It Works

```
┌─────────────┐
│  Your CLI   │  (Claude Code, Codex, OpenClaw, Cursor, Cline...)
│   Tool      │
└──────┬──────┘
       │ http://localhost:3008/v1
       ↓
┌─────────────────────────────────────────────┐
│          KTRouter (Smart Router)            │
│  • RTK Token Saver (cut tool_result tokens) │
│  • Format translation (OpenAI ↔ Claude)     │
│  • Quota tracking                           │
│  • Auto token refresh                       │
└──────┬──────────────────────────────────────┘
       │
       ├─→ [Tier 1: SUBSCRIPTION] Claude Code, Codex, GitHub Copilot
       │   ↓ quota exhausted
       ├─→ [Tier 2: CHEAP] GLM ($0.6/1M), MiniMax ($0.2/1M)
       │   ↓ budget limit
       └─→ [Tier 3: FREE] Kiro, OpenCode Free, Vertex ($300 credits)
```

---

## ⚡ Quick Start

### Option 1: Install Globally via NPM (Recommended)

To run the latest stable version of KTRouter globally on your machine:

```bash
# Install globally
npm install -g ktrouter

# Start the router
ktrouter
```

The CLI will check for updates, boot the background server, and open an interactive menu in your terminal. The Web Dashboard will open at `http://localhost:3008`.

---

### Option 2: Run in Development Mode (From Source)

#### Prerequisites
- Node.js >= 18.0.0
- npm or yarn

#### 1. Clone & Install Dependencies

```bash
git clone https://github.com/dongbao492/ktrouter.git
cd ktrouter
npm install
```

#### 2. Start Developer Mode

To run the Next.js development server:

```bash
npm run dev
```

- **Web Dashboard:** `http://localhost:3008/dashboard`
- **OpenAI-compatible API:** `http://localhost:3008/v1`

---

## 🛠️ Supported CLI & MITM Tools

KTRouter integrates directly with a wide variety of tools:

### MITM-Intercepted Tools
- **Antigravity** (Google daily-cloudcode-pa.googleapis.com interception)
- **GitHub Copilot** (api.individual.githubcopilot.com interception)
- **Kiro** (q.us-east-1.amazonaws.com interception)

### Regular CLI Tools
- **Claude Code** (Anthropic Claude Code CLI)
- **Open Claw** (Open Claw AI Assistant)
- **OpenAI Codex CLI / App**
- **OpenCode** (OpenCode AI Terminal Assistant)
- **Claude Cowork** (Desktop Cowork with third-party inference)
- **Hermes Agent** (Nous Research self-improving AI agent)
- **Factory Droid**
- **Cursor** (Cursor AI Code Editor)
- **Cline** (Cline AI Coding Assistant)
- **Kilo Code**
- **Roo**
- **Continue**
- **Amp CLI** (Sourcegraph Amp coding assistant)
- **Qwen Code** (Alibaba Qwen Code CLI)
- **DeepSeek TUI** (DeepSeek Rust Terminal Coding Agent)
- **jcode** (High-performance Rust-based coding agent harness)

---

## 🌐 Supported Providers

### OAuth / Subscription Providers
- **Claude Code**
- **Antigravity**
- **OpenAI Codex**
- **GitHub Copilot**
- **Cursor IDE**
- **xAI (Grok)**
- **Kilo Code**
- **Cline**

### Free / Unlimited Providers
- **Kiro AI**
- **OpenCode Free**
- **Vertex AI** (GCP $300 free credits)
- **Qwen Code** (Deprecated)
- **Gemini CLI** (Deprecated)
- **iFlow AI**

### API Key Providers
- **GLM Coding (BigModel)**
- **Kimi (Moonshot)**
- **Minimax**
- **OpenAI & Azure OpenAI**
- **Anthropic**
- **DeepSeek**
- **Groq, Together AI, Fireworks, Cerebras, Cohere, Nebius, SiliconFlow, Hyperbolic**
- **Voice (TTS/STT): ElevenLabs, Deepgram, AssemblyAI, AWS Polly, Edge TTS, Google TTS, Local Device**
- **Search & Scraping: Tavily, Brave Search, Serper, Exa, SearXNG, Google PSE, Linkup, SearchAPI, You.com Search, Jina Reader, Firecrawl**
- **Image: fal.ai, Stability AI, Black Forest Labs, Recraft, Topaz, Runway ML**

---

## 📁 Repository Structure

```text
├── cli/                 # The npm package wrapper code
│   ├── cli.js           # CLI entry point (handles update check, daemonizing, TUI)
│   ├── hooks/           # Post-install & self-healing runtime dependencies hooks
│   └── src/             # CLI application source (TUI, tray controller, api layer)
├── src/                 # Next.js web application source code
│   ├── app/             # Next.js App Router (Dashboard pages, API endpoints)
│   ├── shared/          # Shared components, hooks, constants, utils
│   └── lib/             # Backend services (MITM DNS proxy, SQLite helper, database)
├── open-sse/            # AI Provider translation layer (translates OpenAI/Anthropic/Gemini/etc.)
├── data/                # Default SQLite database storage directory
└── package.json         # Root package workspace definition
```

---

## 💻 Command Line Interface

```bash
ktrouter [options]

Options:
  -p, --port <port>   Port to run the Next.js server (default: 3008)
  -H, --host <host>   Host to bind the server to (default: 0.0.0.0)
  -n, --no-browser    Do not open the browser automatically on startup
  -l, --log           Show Next.js server logs directly in stdout
  -t, --tray          Start directly in system tray mode (background daemon)
  --skip-update       Skip automatic NPM registry update check
  -h, --help          Show help message
  -v, --version       Show current version
```

---

## 🔒 Security & Data Privacy

KTRouter stores all of its credentials, database items, log charts, and certificates **locally** on your computer. 

* **Storage Paths:**
  - **Windows:** `%APPDATA%/ktrouter`
  - **macOS / Linux:** `~/.ktrouter`
* **Custom Location:** Set the `DATA_DIR` environment variable to change where KTRouter stores its data files.
* **Telemetry:** KTRouter disables nonessential telemetry and local metrics reporting of underlying CLI agents (like Claude Code) automatically when connected.

---

## 📝 License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
