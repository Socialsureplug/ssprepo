import pino from 'pino';
import { config } from '../config';

/** Structured application logger. Redacts anything that looks like a secret. */
export const logger = pino({
  level: config.isTest ? 'silent' : config.LOG_LEVEL,
  redact: {
    paths: [
      'password', '*.password', 'req.headers.authorization', 'req.headers.cookie', '*.secret', '*.apiKey',
      '*.credentials', '*.token', 'headers.authorization',
    ],
    censor: '[REDACTED]',
  },
  base: { service: 'api' },
});
