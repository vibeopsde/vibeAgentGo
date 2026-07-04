# HAG — Hermes Agent Go

Minimal AI agent with memory, skills, and `render_view` — designed for mobile.

## What is this?

A TypeScript reimplementation of the Hermes Agent core concepts:
- **Agent Loop** with OpenAI-compatible tool calling
- **Persistent Memory** (SQLite) that grows across sessions
- **Skills** as local Markdown files, injected into the system prompt
- **7 Tools**: read_file, write_file, search_files, run_code, web_search, memory_save, render_view
- **render_view**: Agent builds HTML/CSS/JS mini-apps, rendered in a WebView alongside chat
- **QuickJS sandbox**: Sandboxed JavaScript execution (700KB engine, not 200MB Python)

## Quick Start

```bash
# Install
npm install

# Configure
export HAG_API_KEY="sk-..."           # or your OpenRouter/Mac Studio key
export HAG_BASE_URL="https://api.openai.com/v1"  # or http://your-server:1234/v1
export HAG_MODEL="gpt-4o-mini"        # or any model your endpoint supports

# Run
npm run chat

# Or single query
npm run dev -- "What files are in my workspace?"

# Run tests
npm test
```

## Configuration

Config is stored in `~/.hag/config.json`:

```json
{
  "model": "gpt-4o-mini",
  "baseUrl": "https://api.openai.com/v1",
  "apiKey": "your-key",
  "maxTurns": 30
}
```

Or via environment variables: `HAG_API_KEY`, `HAG_BASE_URL`, `HAG_MODEL`, `HAG_HOME`, `HAG_WORKSPACE`

## Architecture

```
src/
├── core/
│   ├── agent.ts          # Agent loop with tool calling
│   ├── llm_client.ts     # OpenAI-compatible HTTP client
│   ├── memory.ts         # SQLite memory + session store
│   └── prompt_builder.ts # System prompt assembly (identity + memory + skills + tools)
├── tools/
│   ├── registry.ts       # 7 tools + dispatch
│   └── quickjs.ts        # QuickJS sandbox for run_code
├── types/
│   └── index.ts          # All TypeScript types
└── index.ts              # CLI entry point
```

## Tools

| Tool | What it does |
|------|-------------|
| `read_file` | Read file from workspace |
| `write_file` | Write file to workspace (creates dirs) |
| `search_files` | Search by filename or content |
| `run_code` | Execute JS in QuickJS sandbox |
| `web_search` | Search the web (DuckDuckGo) |
| `memory_save` | Save durable fact to SQLite |
| `render_view` | Render HTML as live view (WebView in app, file in CLI) |

## Memory

The agent decides what to remember. When it learns a durable fact, it calls `memory_save`:
- Category `"user"` → facts about the user (preferences, name, stack)
- Category `"memory"` → general notes (environment, conventions)

On next session start, all memory is loaded into the system prompt automatically.

## Skills

Skills are Markdown files in `workspace/skills/*.md`:

```markdown
---
name: my-skill
description: What this skill does
trigger: ["keyword1", "keyword2"]
---

# Skill content — loaded into system prompt
```

## render_view

The killer feature. The agent writes HTML/CSS/JS and it renders live:

```
User: "Build me a calculator"
Agent: writes HTML+JS → calls render_view → Calculator appears in view panel
```

In CLI mode, render_view writes HTML files to the workspace. In the mobile app (Phase 2), it opens a WebView panel with tabs.

## Mobile App (Phase 2)

The agent core is platform-agnostic. Phase 2 wraps it in a React Native app:
- Chat UI with streaming
- Render View Panel (WebView + tabs)
- Settings (model, provider, API key)
- Memory viewer
- Session management

## License

MIT