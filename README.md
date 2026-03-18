# Brady News Project

A Windows desktop application for real-time financial news monitoring from Discord, with keyword filtering, LLM analysis, and audio alerts.

## Features

- **Discord Scraping** — Connects directly to Discord and monitors news channels in real-time
- **Keyword Filtering** — Create rulesets with AND/OR/NOT logic, multiple rule groups, and exclusion rules
- **Color-Coded Alerts** — Each ruleset can color-code matched news items and play custom audio alerts
- **LLM Analysis** — Automatically send matched news to a local Ollama LLM for analysis and scoring
- **Score Gating** — Set thresholds so only high-scoring news appears in your feed
- **News Feed** — Card-based display with Discord formatting, keyword highlighting, time filters, and search
- **Reprocessing** — Retroactively apply new rulesets to historical news

## Prerequisites

- **Node.js** (v18 or later) — [Download](https://nodejs.org/)
- **Windows 10/11**
- **Discord Bot Token** — A bot with Message Content Intent enabled, added to the server(s) you want to monitor
- **Ollama** (optional) — For local LLM analysis. [Download](https://ollama.ai/)

## Quick Start

### 1. Clone the repo
```
git clone https://github.com/YOUR_USERNAME/BradyNewsProjectGH.git
cd BradyNewsProjectGH
```

### 2. Install dependencies
Double-click `install.bat` or run:
```
install.bat
```

### 3. Configure
Copy `.env.example` to `.env` and fill in your Discord bot token:
```
copy .env.example .env
notepad .env
```

### 4. Run
Double-click `run.bat` or run:
```
run.bat
```

## Configuration

### .env file
| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_BOT_TOKEN` | Yes | Your Discord bot token |
| `OLLAMA_HOST` | No | Ollama API URL (default: `http://localhost:11434`) |
| `OLLAMA_MODEL` | No | Ollama model name (default: `qwen3:32b`) |

### Discord Bot Setup
1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application and add a bot
3. Enable **Message Content Intent** under Privileged Gateway Intents
4. Copy the bot token to your `.env` file
5. Invite the bot to your server with Read Messages permission

## Project Structure

```
├── electron/           # Main process code
│   ├── main.js         # App entry point
│   ├── database.js     # SQLite database layer
│   ├── discord-scraper.js  # Discord gateway connection
│   ├── keyword-engine.js   # Keyword filtering engine
│   ├── llm-processor.js    # LLM queue processor
│   ├── content-fetcher.js  # Article content extractor
│   └── preload.js      # Electron preload bridge
├── src/                # Renderer (UI)
│   ├── index.html      # Main HTML
│   ├── styles.css      # Styles
│   └── renderer.js     # UI logic
├── data/               # Runtime data (gitignored)
│   ├── brady-news.db   # SQLite database
│   └── audio/          # Uploaded audio files
├── .env                # Secrets (gitignored)
├── .env.example        # Template for .env
├── install.bat         # One-click installer
├── run.bat             # One-click launcher
└── package.json
```
