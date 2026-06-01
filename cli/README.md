# KTRouter CLI (`ktrouter`)

[![npm version](https://img.shields.io/npm/v/ktrouter.svg)](https://www.npmjs.com/package/ktrouter)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![GitHub Repository](https://img.shields.io/badge/GitHub-Repository-blue?logo=github)](https://github.com/dongbao492/ktrouter)

**KTRouter CLI** is the global command-line interface and background daemon wrapper for **[KTRouter](https://github.com/dongbao492/ktrouter)** (the local AI proxy router and developer dashboard). 

It manages the background Next.js server, handles automatic self-healing native dependencies, runs an interactive terminal control panel (TUI), and integrates seamlessly into the system tray.

---

## 🚀 Installation & Launch

Install KTRouter globally using your favorite Node package manager:

```bash
npm install -g ktrouter
```

Launch the router by running:

```bash
ktrouter
```

Upon launching, the CLI will automatically:
1. Self-heal/re-verify SQLite native binaries and system tray dependencies.
2. Check the NPM registry for any newer stable releases.
3. Clean up stale background processes (such as orphans from previous runs).
4. Launch the local Next.js server (defaults to port `3008`).
5. Open the interactive command menu in your terminal.

---

## 💻 CLI Flags & Commands

```bash
ktrouter [options]

Options:
  -p, --port <port>   Port to run the server on (default: 3008)
  -H, --host <host>   Host to bind the server to (default: 0.0.0.0)
  -n, --no-browser    Don't open the Web Dashboard browser automatically
  -l, --log           Output live Next.js server stdout logs directly to the console
  -t, --tray          Start in system tray mode directly (background daemon)
  --skip-update       Skip the NPM registry auto-update check
  -h, --help          Show this help menu
  -v, --version       Show the installed package version
```

---

## ⌨️ Interactive Menu & Terminal UI (TUI)

If run in an interactive shell, the CLI exposes a rich, menu-driven Terminal UI (TUI) with:

1. **Web UI (Open in Browser):** Directly opens the premium Next.js Web Dashboard (`http://localhost:3008/dashboard`).
2. **Terminal UI (Interactive CLI):** A terminal-based config editor allowing you to manage:
   - **Providers:** Add, edit, and configure connections to OpenAI, Anthropic, Gemini, DeepSeek, Vertex AI, OpenRouter, etc.
   - **API Keys:** Add local custom keys for client tool authorization.
   - **Combos:** Define model router aliases and fallback configurations.
   - **CLI Tools:** Auto-configure tools like Claude Code, Cline, Codex, Cursor, and Copilot directly from the terminal.
3. **Hide to Tray (Background):** Daemonizes the server, exits the terminal safely, and attaches a system tray indicator.
4. **Auto-Update Launcher:** Performs an online update with a single click when a new version is detected.

---

## ⚙️ Architecture & Self-Healing Runtime

To ensure maximum stability, ease of updates, and compatibility with strict desktop environments, KTRouter uses a unique **lazy runtime architecture**:

- **No Locked Global DLLs (SQLite):** Global Node.js binaries on Windows often suffer from file locking (`EBUSY`) during updates if native `.node` bindings (like `better-sqlite3`) are locked. KTRouter solves this by lazy-installing native SQLite dependencies into the local user folder (`~/.ktrouter/runtime/node_modules/`) at post-install or runtime.
- **Kaspersky-Safe System Tray:** To avoid false-positive antivirus warnings from unsigned Go executables:
  - **macOS / Linux:** Lazily builds and caches the `systray2` runtime dependencies into user directories.
  - **Windows:** Employs a zero-binary, highly efficient background PowerShell NotifyIcon script to manage tray indicators, ensuring 100% compliance with corporate security tools.

---

## 📁 Storage Location

All KTRouter configurations, the SQLite database, generated certificates, and logs are stored locally on your machine:

- **Windows:** `%APPDATA%/ktrouter`
- **macOS / Linux:** `~/.ktrouter`

*To change this folder location, set the `DATA_DIR` environment variable before starting `ktrouter`.*

---

## 🛠️ Build & Pack Package (For Contributors)

If you are modifying or compiling the package from source:

```bash
# Navigate to the CLI directory
cd cli

# Build the Next.js standalone app and bundle files
npm run build

# Pack into a tarball
npm pack
```

---

## 📝 License

MIT License - see `LICENSE` in the repository root.
