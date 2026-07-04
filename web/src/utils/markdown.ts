// ============================================================
// vibeAgentGo — Safe Markdown rendering for assistant messages
// ============================================================

import { marked } from 'marked';
import DOMPurify from 'dompurify';

export function renderMarkdown(text?: string | null): string {
  const safe = (text || '').toString();
  const raw = marked.parse(safe, { gfm: true, breaks: true }) as string;
  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: [
      'p', 'br', 'strong', 'em', 'del', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'ul', 'ol', 'li', 'a', 'code', 'pre', 'blockquote', 'hr', 'table',
      'thead', 'tbody', 'tr', 'th', 'td'
    ],
    ALLOWED_ATTR: ['href', 'title', 'target', 'class'],
  });
}
