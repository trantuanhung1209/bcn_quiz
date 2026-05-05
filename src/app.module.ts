import { Module } from '@nestjs/common';
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
import { RequestLoggingInterceptor } from './common/logging/request-logging.interceptor';
import { createWinstonLoggerOptions } from './common/logging/winston.config';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    WinstonModule.forRoot(createWinstonLoggerOptions(process.env.SERVICE_NAME ?? 'quiz_api')),
    ThrottlerModule.forRoot([{
      ttl: 60000,
      limit: 100,
    }]),
    ScheduleModule.forRoot(),
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
    RequestLoggingInterceptor,
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
export class AppModule {}
