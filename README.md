# vibeAgentGo

A fully client-side AI agent PWA. Memory, sessions, files, and skills live in your browser. Only LLM API calls leave the device.

## What is this?

A fully client-side AI agent PWA, built from scratch for mobile and data sovereignty:

- **Agent Loop** with OpenAI-compatible tool calling (multi-turn, streaming)
- **Persistent Memory** in IndexedDB across sessions
- **Skills** stored in IndexedDB, injected into the system prompt
- **9 Tools** including file I/O, PDF extraction, web search, memory, error log, and code execution
- **Code Sandbox**: A single `run` tool executes JavaScript in a Web Worker with CDN imports, workspace I/O, and interactive HTML rendering
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
| Base URL | (auto) | Set automatically by the selected provider preset |
| API Key | — | Your endpoint key (hidden for local endpoints) |
| Max Turns | 30 | Loop safety limit |
| Language | system default | `de` or `en`; detected from `navigator.language` |
| Search Provider | `none` | Optional Tavily web search |
| Search API Key | — | Key for the configured search provider |

On first launch the onboarding wizard lets you pick a fixed provider preset. Presets include ki.vibeops.de (LM Studio), Kimi Code, Ollama Cloud, and OpenCode Go/Zen.

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
| `run` | Execute JavaScript in a Web Worker sandbox with CDN imports, workspace I/O, and `render(title, html)` for interactive views |
| `web_search` | Web search via configured provider (Tavily, CORS-dependent — use your own proxy if the endpoint lacks CORS) |
| `memory_save` | Save a durable fact to IndexedDB memory |
| `memory_search` | Search existing memory entries by keyword |

## Memory

The agent decides what to remember. When it learns a durable fact, it calls `memory_save`:

- Category `"user"` → facts about the user (preferences, name, stack)
- Category `"memory"` → general notes (environment, conventions)

On each run, memory is loaded into the system prompt automatically. The `memory_search` tool lets the agent recall specific facts on demand.

After each assistant response, the agent also extracts new durable facts from the conversation in the background and stores them automatically.

## Skills

Skills are Markdown files with optional YAML frontmatter (`name`, `description`, `triggers`). They are stored in IndexedDB and loaded into the system prompt on every run. When a user message contains a trigger word, the matching skill is automatically injected. The **Skills** panel lets you create, edit, and delete skills.

## Code Sandbox

The agent can write and execute JavaScript in a Web Worker sandbox. It can also render interactive HTML/CSS/JS views via `render(title, html)` inside the `run` tool:

```
User: "Build me a calculator"
Agent: calls run with code that renders HTML+JS → Calculator appears in the view panel
```

The sandbox runs in a Web Worker with no DOM access. It has no access to `parent`, `window.document`, `fetch`, `localStorage`, or direct IndexedDB. File I/O goes through the workspace bridge (`fs.readFile/writeFile/listFiles`). Console output is captured and returned.

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
