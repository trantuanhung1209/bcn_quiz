import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
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
import { RequestLoggingInterceptor } from './common/logging/request-logging.interceptor';
import { RequestLoggingMiddleware } from './common/logging/request-logging.middleware';
import { createWinstonLoggerOptions } from './common/logging/winston.config';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    WinstonModule.forRoot(createWinstonLoggerOptions(process.env.SERVICE_NAME ?? 'quiz_api')),
    ThrottlerModule.forRoot([{
      ttl: 60000,
      limit: 100,
    }]),
    ScheduleModule.forRoot(),
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
    {
      provide: GetResponseCache,
      useFactory: () => new GetResponseCache(),
    },
    GetCacheInterceptor,
    RequestLoggingInterceptor,
    RequestLoggingMiddleware,
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
