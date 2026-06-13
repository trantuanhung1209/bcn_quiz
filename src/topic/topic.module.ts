import { Module } from '@nestjs/common';
import { TopicController } from './topic.controller';
import { TopicService } from './topic.service';
import { PrismaService } from '../prisma/prisma.service';
import { CloudinaryService } from '../common/storage/cloudinary.service';

@Module({
  controllers: [TopicController],
  providers: [TopicService, PrismaService, CloudinaryService],
})
export class TopicModule {}
