import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { json, urlencoded } from 'express';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import helmet from 'helmet';
import compression from 'compression';
import { AppModule } from './app.module';
import { GetCacheInterceptor } from './common/cache/get-cache.interceptor';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { RequestLoggingInterceptor } from './common/logging/request-logging.interceptor';

async function bootstrap() {
  // Disable default ~100kb parser so bulk POST /quiz/bulk (200 quizzes) is not 413.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    bodyParser: false,
  });
  const logger = app.get(WINSTON_MODULE_NEST_PROVIDER);
  app.useLogger(logger);

  const bodyLimit = process.env.BODY_LIMIT ?? '5mb';
  app.use(json({ limit: bodyLimit }));
  app.use(urlencoded({ extended: true, limit: bodyLimit }));

  app.use(helmet());
  app.use(compression());

  const envOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  // React (Vite :5173), Next.js (:3000/:3001), uside.id.vn + extras via CORS_ORIGINS
  const allowedOrigins: (string | RegExp)[] = [
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
    /^https?:\/\/(.*\.)?uside\.id\.vn$/,
    /^https?:\/\/(.*\.)?uside\.studio$/,
    /^https:\/\/([a-z0-9-]+\.)*bcn\.id\.vn$/,
    /^https:\/\/.+\.vercel\.app$/,
    'https://profiles-uside-studio.vercel.app',
    'https://quizzes-uside-studio.vercel.app',
    ...envOrigins,
  ];

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      // Cho phép request không có origin (curl, Postman, server-to-server)
      if (!origin) {
        callback(null, true);
        return;
      }

      const isAllowed = allowedOrigins.some((allowedOrigin) =>
        typeof allowedOrigin === 'string'
          ? allowedOrigin === origin
          : allowedOrigin.test(origin),
      );

      if (isAllowed) {
        callback(null, true);
      } else {
        callback(new Error(`Cross-Origin Request Blocked: ${origin}`));
      }
    },
    credentials: true,
    exposedHeaders: ['X-Request-Id', 'X-Response-Time-Ms', 'X-Cache'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalInterceptors(
    app.get(GetCacheInterceptor),
    app.get(RequestLoggingInterceptor),
    new ResponseInterceptor(),
  );

  const port = getRequiredPort();
  await app.listen(port);
  logger.log(`Application is running on port: ${port}`);
}

function getRequiredPort(): string {
  const port = process.env.PORT;

  if (!port) {
    throw new Error('PORT environment variable is required');
  }

  return port;
}

void bootstrap();
