import { Module } from '@nestjs/common';
import { QuizController } from './quiz.controller';
import { QuizService } from './quiz.service';
import { PrismaService } from '../prisma/prisma.service';
import { CloudinaryService } from '../common/storage/cloudinary.service';

@Module({
  controllers: [QuizController],
  providers: [QuizService, PrismaService, CloudinaryService],
  exports: [PrismaService],
})
export class QuizModule {}
