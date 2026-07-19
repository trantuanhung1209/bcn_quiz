import { Module } from '@nestjs/common';
import { TopicController } from './topic.controller';
import { TopicService } from './topic.service';
import { CloudinaryService } from '../common/storage/cloudinary.service';
import { CourseModule } from '../course/course.module';

@Module({
  imports: [CourseModule],
  controllers: [TopicController],
  providers: [TopicService, CloudinaryService],
})
export class TopicModule {}
