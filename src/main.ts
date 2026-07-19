import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import helmet from 'helmet';
import compression from 'compression';
import { AppModule } from './app.module';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { RequestLoggingInterceptor } from './common/logging/request-logging.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = app.get(WINSTON_MODULE_NEST_PROVIDER);
  app.useLogger(logger);

  app.use(helmet());
  app.use(compression());

  const envOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  const allowedOrigins: (string | RegExp)[] = [
    /^http:\/\/localhost:\d+$/, // Localhost React/Vite development
    /^http:\/\/127\.0\.0\.1:\d+$/, // 127.0.0.1 development
    /^https?:\/\/(.*\.)?uside\.studio$/, // uside.studio and its subdomains
    ...envOrigins,
    'https://quizzes-uside-studio.vercel.app', // Vercel deployment
    'https://profiles-uside-studio.vercel.app',
    'https://quizzes.uside.id.vn'
  ];

  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      // Cho phép request không có origin (như curl, postman, server-to-server)
      if (!origin) return callback(null, true);

      const isAllowed = allowedOrigins.some((allowedOrigin) =>
        typeof allowedOrigin === 'string'
          ? allowedOrigin === origin
          : allowedOrigin.test(origin),
      );

      if (isAllowed) {
        callback(null, true);
      } else {
        callback(new Error('Cross-Origin Request Blocked'));
      }
    },
    credentials: true,
    exposedHeaders: ['X-Request-Id', 'X-Response-Time-Ms'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalInterceptors(app.get(RequestLoggingInterceptor), new ResponseInterceptor());

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

bootstrap();
