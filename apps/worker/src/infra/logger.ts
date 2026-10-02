import pino from 'pino';

/** Structured JSON logs. Job payloads are never logged: email jobs carry one-time links. */
export function createLogger(level: string, pretty: boolean) {
  return pino({
    level,
    base: { service: 'tuello-worker' },
    redact: { paths: ['*.vars', '*.link', '*.token', '*.password', 'data'], censor: '[redacted]' },
    ...(pretty ? { transport: { target: 'pino-pretty', options: { singleLine: true } } } : {}),
  });
}

export type Log = ReturnType<typeof createLogger>;
export const LOG = Symbol('LOG');
