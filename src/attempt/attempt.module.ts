import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AttemptController } from './attempt.controller';
import { AttemptService } from './attempt.service';
import { AttemptSessionCleanupService } from './attempt-session-cleanup.service';
import { CourseModule } from '../course/course.module';

@Module({
  imports: [CourseModule],
  controllers: [AttemptController],
  providers: [AttemptService, AttemptSessionCleanupService, PrismaService],
})
export class AttemptModule {}
