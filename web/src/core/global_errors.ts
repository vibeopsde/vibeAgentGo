// ============================================================
// vibeAgentGo — Global error capture
// Registers window.onerror, unhandledrejection, and rejectionhandled
// and routes them to the IndexedDB logger so crashes can be inspected
// even if the UI resets.
// ============================================================

import { logger } from './logger.js';

let isRegistered = false;

function errorDetailsFromEvent(event: ErrorEvent | PromiseRejectionEvent): Record<string, unknown> {
  const de: Record<string, unknown> = {};
  if (event instanceof ErrorEvent) {
    if (event.filename) de.filename = event.filename;
    if (event.lineno) de.lineno = event.lineno;
    if (event.colno) de.colno = event.colno;
    if (event.error) {
      de.errorName = (event.error as Error)?.name ?? 'Unknown';
      de.errorStack = (event.error as Error)?.stack ?? '';
      de.errorMessage = (event.error as Error)?.message ?? String(event.error);
    } else {
      de.message = event.message;
    }
  } else {
    de.reason = event.reason;
    if (event.reason instanceof Error) {
      de.errorName = event.reason.name;
      de.errorStack = event.reason.stack;
      de.errorMessage = event.reason.message;
    }
  }
  return de;
}

export function registerGlobalErrorHandlers(): void {
  if (typeof window === 'undefined' || isRegistered) return;
  isRegistered = true;

  window.addEventListener(
    'error',
    (event) => {
      logger.fatal('global.error', `Uncaught error: ${event.message}`, errorDetailsFromEvent(event));
      // Prevent the default browser console spam? No — keep DevTools visible
    },
    true
  );

  window.addEventListener(
    'unhandledrejection',
    (event) => {
      logger.fatal('global.rejection', `Unhandled promise rejection`, errorDetailsFromEvent(event));
      event.preventDefault();
    },
    true
  );

  window.addEventListener(
    'rejectionhandled',
    (event) => {
      logger.warn('global.rejectionHandled', `Late-handled promise rejection`, errorDetailsFromEvent(event));
    },
    true
  );

  // Capture console.error as warning logs, but avoid infinite recursion if
  // logger itself writes to console.error.
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    originalError.apply(console, args);
    try {
      const message = args.map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
      if (message.length > 0 && !message.startsWith('[')) {
        logger.error('console.error', message.slice(0, 500));
      }
    } catch {
      /* ignore */
    }
  };
}

export function captureFunctionError(source: string, error: unknown, extra?: Record<string, unknown>): void {
  const details: Record<string, unknown> = { ...extra };
  if (error instanceof Error) {
    details.errorName = error.name;
    details.errorMessage = error.message;
    details.errorStack = error.stack;
  } else {
    details.error = String(error);
  }
  logger.error(source, `Caught error: ${error instanceof Error ? error.message : String(error)}`, details);
}

export function captureInfo(source: string, message: string, extra?: Record<string, unknown>): void {
  logger.info(source, message, extra);
}

export function captureWarn(source: string, message: string, extra?: Record<string, unknown>): void {
  logger.warn(source, message, extra);
}
