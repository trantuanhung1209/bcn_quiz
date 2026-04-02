import { Module } from '@nestjs/common';
import { TopicController } from './topic.controller';
import { TopicService } from './topic.service';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  controllers: [TopicController],
  providers: [TopicService, PrismaService],
})
export class TopicModule {}
