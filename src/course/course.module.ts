import { Module } from '@nestjs/common';
import { ProfilesModule } from '../profiles/profiles.module';
import { CloudinaryService } from '../common/storage/cloudinary.service';
import { CourseController } from './course.controller';
import { CourseProgressService } from './course-progress.service';
import { CourseService } from './course.service';

@Module({
  imports: [ProfilesModule],
  controllers: [CourseController],
  providers: [CourseService, CourseProgressService, CloudinaryService],
  exports: [CourseProgressService],
})
export class CourseModule {}
