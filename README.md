# vibeAgentGo

A fully client-side AI agent PWA. Memory, sessions, files, skills, and project state live in your browser. Only LLM API calls leave the device.

## What is this?

A fully client-side AI agent PWA, built from scratch for mobile and data sovereignty:

- **Agent Loop** with OpenAI-compatible tool calling (multi-turn, streaming)
- **Persistent Memory** in IndexedDB across sessions
- **Skills** stored in IndexedDB, injected into the system prompt
- **Project State** scratchpad (`agent_state.json`) for long-running tasks
- **12 Tools** including file I/O, code sandbox, web search, memory, state, render, and debug
- **render_view**: Agent builds HTML/CSS/JS mini-apps rendered in a sandboxed iframe panel
- **Multimodal Attachments**: Images are sent directly to the LLM; text files and PDFs are stored in the workspace
- **Backup & Restore**: Export and import all data as a single ZIP file
- **Sessions**: Resume, browse, and delete past conversations

## Quick Start

```bash
npm install
npm run dev        # local dev server
npm run build      # production build (web/dist)
npm test           # vitest unit tests
```

Open the served URL, complete the onboarding wizard, and start chatting.

## Configuration

Stored in `localStorage` (never sent to any server):

| Setting | Default | Description |
|---------|---------|-------------|
| Model | (empty) | OpenAI-compatible model id (auto-filled by provider preset) |
| Base URL | (empty) | OpenAI-compatible endpoint (must allow CORS) |
| API Key | — | Your endpoint key |
| Max Turns | 30 | Loop safety limit |
| Language | system default | `de` or `en`; detected from `navigator.language` |
| Search Provider | `none` | Optional Tavily web search |
| Search API Key | — | Key for the configured search provider |

On first launch the onboarding wizard lets you pick a preset or enter your own endpoint. Presets include OpenRouter, OpenCode (go/zen), and Ollama Cloud.

## Architecture

```
web/
├── index.html              # PWA entry
├── public/                 # PWA manifest, service worker, icon, PDF worker
├── src/
│   ├── main.ts             # App bootstrap, layout, UI wiring, agent lifecycle
│   ├── core/
│   │   ├── agent.ts        # Multi-turn browser agent loop
│   │   ├── llm_client.ts   # SSE streaming fetch client + connection test
│   │   ├── memory.ts       # IndexedDB memory, sessions, files, skills, config
│   │   ├── prompt_builder.ts
│   │   ├── tools.ts        # Browser tool implementations
│   │   ├── state.ts        # Project state helpers (agent_state.json)
│   │   ├── backup.ts       # ZIP export/import of all local data
│   │   ├── presets.ts      # OpenAI-compatible provider presets
│   │   ├── skill_parser.ts # Skill markdown + YAML frontmatter parsing
│   │   ├── theme.ts        # Light/dark/system theme handling
│   │   └── uuid.ts         # Random ID helpers
│   ├── components/         # ChatPanel, RenderPanel, SettingsModal, MemoryPanel, SessionPanel, SkillsPanel, MobileNav, OnboardingWizard
│   ├── i18n/               # UI + system-prompt language handling
│   ├── styles/             # Mobile-first dark/light CSS
│   ├── utils/              # Markdown, sandbox, HTML escaping
│   ├── types/index.ts      # Shared TypeScript types
│   └── version.ts          # Single source of truth for app version
├── tests/                  # Vitest + jsdom + fake-indexeddb tests
└── dist/                   # Build output
```

## Tools

| Tool | What it does |
|------|-------------|
| `read_file` | Read a text file from the IndexedDB workspace |
| `read_pdf` | Extract text from a PDF in the workspace using `pdfjs-dist` |
| `write_file` | Write a file to the IndexedDB workspace |
| `search_files` | Search filenames or contents in the workspace |
| `run_code` | Execute JS in a sandboxed iframe (`srcdoc` + `sandbox="allow-scripts"`) |
| `web_search` | Web search via configured provider (Tavily, CORS-dependent — use your own proxy if the endpoint lacks CORS) |
| `memory_save` | Save a durable fact to IndexedDB memory |
| `memory_search` | Search existing memory entries by keyword |
| `state_view` | Read the project state from `agent_state.json` |
| `state_update` | Update project state: goal, phase, tasks, issues, lessons, files |
| `render_view` | Render HTML as a live view in the iframe panel |
| `inspect_view` | Retrieve captured console logs/errors from a rendered view |

## Memory

The agent decides what to remember. When it learns a durable fact, it calls `memory_save`:

- Category `"user"` → facts about the user (preferences, name, stack)
- Category `"memory"` → general notes (environment, conventions)

On each run, memory is loaded into the system prompt automatically. The `memory_search` tool lets the agent recall specific facts on demand.

After each assistant response, the agent also extracts new durable facts from the conversation in the background and stores them automatically.

## Skills

Skills are Markdown files with optional YAML frontmatter (`name`, `description`, `triggers`). They are stored in IndexedDB and loaded into the system prompt on every run. When a user message contains a trigger word, the matching skill is automatically injected. The **Skills** panel lets you create, edit, and delete skills.

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

The rendered view runs in a sandboxed iframe via `srcdoc`. The `inspect_view` tool can retrieve its console logs, errors, and unhandled exceptions for debugging.

### Code Sandbox (`run_code`)

`run_code` executes JavaScript in an isolated `blob:`-origin iframe with `sandbox="allow-scripts"`. It has no access to `parent`, `window.document`, `fetch`, `indexedDB`, or the main page's `localStorage`. A `log()` function and a limited `console` are injected for output.

## Multimodal Attachments

You can attach files to chat messages:

- **Images** are sent as base64 `image_url` content parts directly to the LLM.
- **Text files** and **PDFs** are saved to the IndexedDB workspace; the agent can read them with `read_file` or `read_pdf`.

## Backup & Restore

Because all data is client-side, vibeAgentGo can export your entire state as a single ZIP file:

```
vibeAgentGo-backup-YYYY-MM-DD.zip
├── manifest.json
├── memory.json
├── sessions.json
├── skills.json
├── config.json
├── theme.json
├── onboarding.json
└── files/
```

Use **Settings → Backup & Restore** to export or import. API keys are redacted by default and preserved from the current browser when importing a redacted backup.

## Theme & Language

- **Theme**: system / light / dark, stored in `localStorage`
- **Language**: German or English, used for both the UI and the system prompt

## License

MIT
