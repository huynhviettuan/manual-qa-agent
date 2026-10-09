import pino, { type Logger } from 'pino';

export type { Logger };

// Field paths that must never reach logs, wherever they appear in a log object.
const REDACT_PATHS = [
  'apiKey',
  '*.apiKey',
  'authorization',
  '*.authorization',
  'headers.authorization',
  'req.headers.authorization',
  'req.headers["x-api-key"]',
  '*.content',
  '*.prompt',
];

/** Structured JSON logger; bind `correlationId` per request/workflow via `logger.child`. */
export function createLogger(opts: { level?: string; name?: string } = {}): Logger {
  return pino({
    name: opts.name ?? 'manual-qa-agent',
    level: opts.level ?? process.env.LOG_LEVEL ?? 'info',
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  });
}

export const silentLogger: Logger = pino({ level: 'silent' });
