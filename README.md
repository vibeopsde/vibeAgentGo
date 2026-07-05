# vibeAgentGo

A fully client-side AI agent PWA. Memory, sessions, files, and skills live in your browser. Only LLM API calls leave the device.

> **Conceptual origin:** vibeAgentGo is an independent, from-scratch reimplementation of ideas from **Hermes Agent** by **Nous Research** (MIT licensed). See [`LICENSE-THIRD-PARTY.md`](./LICENSE-THIRD-PARTY.md) for the full MIT license text and attribution.

## What is this?

A TypeScript reimplementation of the Hermes Agent core concepts, designed for mobile and data sovereignty:

- **Agent Loop** with OpenAI-compatible tool calling (multi-turn, streaming)
- **Persistent Memory** in IndexedDB across sessions
- **Skills** stored in IndexedDB, injected into the system prompt
- **9 Tools**: `read_file`, `write_file`, `search_files`, `run_code`, `web_search`, `memory_save`, `state_view`, `state_update`, `render_view`
- **render_view**: Agent builds HTML/CSS/JS mini-apps rendered in a sandboxed iframe panel
- **Sessions**: Resume, browse, and delete past conversations

## Quick Start

```bash
npm install
npm run dev        # local dev server
npm run build      # production build (web/dist)
npm test           # vitest unit tests
```

Open the served URL, enter your API key in Settings, and start chatting.

## Configuration

Stored in `localStorage` (never sent to any server):

| Setting | Default | Description |
|---------|---------|-------------|
| Model | `gpt-4o` | OpenAI-compatible model id |
| Base URL | `https://api.openai.com/v1` | OpenAI-compatible endpoint (must allow CORS) |
| API Key | — | Your endpoint key |
| Max Turns | 30 | Loop safety limit |

On first launch the onboarding wizard lets you pick a preset or enter your own endpoint. Presets include OpenAI, OpenRouter, and Ollama (local).

## Architecture

```
web/
├── index.html              # PWA entry
├── src/
│   ├── main.ts             # App bootstrap + UI wiring
│   ├── core/
│   │   ├── agent.ts        # Multi-turn browser agent loop
│   │   ├── llm_client.ts   # SSE streaming fetch client
│   │   ├── memory.ts       # IndexedDB memory, sessions, files, skills
│   │   ├── prompt_builder.ts
│   │   ├── tools.ts        # Browser tool implementations
│   │   └── uuid.ts
│   ├── components/         # ChatPanel, RenderPanel, Settings, Memory, Session modals
│   ├── styles/
│   └── types/index.ts      # Shared TypeScript types
├── tests/                  # Vitest + jsdom tests
└── dist/                   # Build output
```

## Tools

| Tool | What it does |
|------|-------------|
| `read_file` | Read a file from the IndexedDB workspace |
| `write_file` | Write a file to the IndexedDB workspace |
| `search_files` | Search filenames or contents in the workspace |
| `run_code` | Execute JS in a sandboxed iframe (`srcdoc` + `sandbox="allow-scripts"`) |
| `web_search` | Web search via configured provider (Tavily, CORS-dependent — use your own proxy if the endpoint lacks CORS) |
| `memory_save` | Save a durable fact to IndexedDB memory |
| `state_view` | Read the project state from `agent_state.json` |
| `state_update` | Update project state: goal, phase, tasks, issues, lessons, files |
| `render_view` | Render HTML as a live view in the iframe panel |

## Memory

The agent decides what to remember. When it learns a durable fact, it calls `memory_save`:

- Category `"user"` → facts about the user (preferences, name, stack)
- Category `"memory"` → general notes (environment, conventions)

On each run, memory is loaded into the system prompt automatically.

## Skills

Skills are stored in IndexedDB. They are loaded into the system prompt on every run. A UI to create and edit skills is planned.

## Agentic Project State

For long-running projects the agent uses `agent_state.json` as a shared scratchpad:

- `goal` and `current_phase`
- `tasks[]` with status, dependencies, notes
- `open_issues[]` with severity
- `lessons_learned[]`
- `files[]` relevant to the project

Call `state_view` to load context and `state_update` to keep progress in sync. Use `render: true` to show an interactive dashboard in the render panel.

## render_view

The agent can write HTML/CSS/JS and display it live:

```
User: "Build me a calculator"
Agent: writes HTML+JS → calls render_view → Calculator appears in the view panel
```

The rendered view runs in a sandboxed iframe via `srcdoc`.

### Code Sandbox (`run_code`)

`run_code` executes JavaScript in an isolated `blob:`-origin iframe with `sandbox="allow-scripts"`. It has no access to `parent`, `window.document`, `fetch`, `indexedDB`, or the main page's `localStorage`. A `log()` function and a limited `console` are injected for output.

## License

MIT
