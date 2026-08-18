// ============================================================
// vibeAgentGo — System tools (help)
// Split from tools.ts (v2608.1.0); keep tool result caps unchanged.
// ============================================================

import type { Tool } from '../../types/index.js';
import { asString } from './shared.js';
import sandboxRef from '../refs/sandbox.md?raw';
import uiRef from '../refs/ui.md?raw';
import toolsRef from '../refs/tools.md?raw';

const HELP_TOPICS: Record<string, string> = {
  sandbox: 'Sandbox-Iframe: run_app, Event-Listener, Canvas, localStorage, Bridge-API (window.vibeAgentGo)',
  ui: 'UI/CSS: Theme-Variablen, Window-Manager-Struktur, App-Factory-Muster',
  tools: 'Tools: alle verfügbaren Tools mit Parametern und typischen Workflows',
};

const HELP_BUILTINS: Record<string, string> = {
  sandbox: sandboxRef,
  ui: uiRef,
  tools: toolsRef,
};

export const help: Tool = {
  name: 'help',
  description:
    'Read built-in reference documentation. Available topics: "sandbox" (iframe, events, canvas, bridge API), "ui" (CSS variables, window-manager structure, app pattern), "tools" (all tool parameters and workflows). Call without arguments to list topics. Call with a topic to get the full reference.',
  parameters: {
    type: 'object',
    properties: {
      topic: {
        type: 'string',
        description: 'Topic to read: "sandbox", "ui", or "tools". Omit to list all topics.',
      },
    },
  },
  handler: async (args: Record<string, unknown>) => {
    const topic = asString(args.topic);
    if (!topic) {
      return (
        'Available help topics:\n' +
        Object.entries(HELP_TOPICS)
          .map(([k, v]) => `  - ${k}: ${v}`)
          .join('\n') +
        '\n\nCall help({ topic: "..." }) to read a topic.'
      );
    }
    // Try built-in references first
    const builtIn = HELP_BUILTINS[topic];
    if (builtIn) return builtIn;
    // Try workspace file (e.g. help({ topic: "custom.md" }) reads ./custom.md)
    return `Unknown topic: "${topic}". Available topics: ${Object.keys(HELP_TOPICS).join(', ')}`;
  },
};
