import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { WinstonModule } from 'nest-winston';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { QuizModule } from './quiz/quiz.module';
import { TopicModule } from './topic/topic.module';
import { AttemptModule } from './attempt/attempt.module';
import { BearerAuthGuard } from './auth/guards/auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { CourseModule } from './course/course.module';
import { CertificateModule } from './certificate/certificate.module';
import { GetCacheInterceptor } from './common/cache/get-cache.interceptor';
import { GetResponseCache } from './common/cache/get-response.cache';
import { HttpExceptionEnvelopeFilter } from './common/filters/http-exception-envelope.filter';
import { RequestLoggingInterceptor } from './common/logging/request-logging.interceptor';
import { RequestLoggingMiddleware } from './common/logging/request-logging.middleware';
import { createWinstonLoggerOptions } from './common/logging/winston.config';
import { PrismaModule } from './prisma/prisma.module';
import { createRedisClient } from './redis/redis.factory';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    WinstonModule.forRoot(
      createWinstonLoggerOptions(process.env.SERVICE_NAME ?? 'quiz_api'),
    ),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const prefix =
          config.get<string>('REDIS_PREFIX')?.trim() ||
          config.get<string>('REDIS_KEY_PREFIX')?.trim() ||
          'bcn:quiz:';
        const redis = createRedisClient(config, {
          keyPrefix: `${prefix}throttler:`,
          lazyConnect: false,
        });
        return {
          throttlers: [
            {
              ttl: 60_000,
              limit: 100,
            },
          ],
          storage: new ThrottlerStorageRedisService(redis),
        };
      },
    }),
    ScheduleModule.forRoot(),
    RedisModule,
    PrismaModule,
    AuthModule,
    QuizModule,
    TopicModule,
    AttemptModule,
    CourseModule,
    CertificateModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    GetResponseCache,
    GetCacheInterceptor,
    RequestLoggingInterceptor,
    RequestLoggingMiddleware,
    {
      provide: APP_FILTER,
      useClass: HttpExceptionEnvelopeFilter,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: BearerAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestLoggingMiddleware).forRoutes('*');
  }
}
