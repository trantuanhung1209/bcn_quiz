import * as fs from 'node:fs';
import * as path from 'node:path';
import type { LoggerOptions } from 'winston';
import * as winston from 'winston';
import LokiTransport from 'winston-loki';

export function createWinstonLoggerOptions(service: string): LoggerOptions {
  const logDir = process.env.LOG_DIR ?? path.join(process.cwd(), 'logs');
  const transports: winston.transport[] = [new winston.transports.Console()];

  if (process.env.LOG_FILE_ENABLED !== 'false' && !process.env.DYNO) {
    fs.mkdirSync(logDir, { recursive: true });
    transports.push(
      new winston.transports.File({
        filename: path.join(logDir, `${service}.log`),
      }),
    );
  }

  if (process.env.LOKI_ENABLED === 'true' && process.env.LOKI_HOST) {
    transports.push(
      new LokiTransport({
        host: process.env.LOKI_HOST,
        basicAuth: process.env.LOKI_BASIC_AUTH,
        labels: {
          service,
          service_name: service,
        },
        json: true,
        batching: true,
        format: winston.format.json(),
        interval: Number(process.env.LOKI_BATCH_INTERVAL_SECONDS ?? 5),
        replaceTimestamp: true,
        gracefulShutdown: true,
        timeout: Number(process.env.LOKI_TIMEOUT_MS ?? 10000),
      }) as unknown as winston.transport,
    );
  }

  return {
    level: process.env.LOG_LEVEL ?? 'info',
    defaultMeta: {
      service,
      service_name: service,
    },
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.json(),
    ),
    transports,
  };
}
