import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Put,
  Delete,
  Query,
} from '@nestjs/common';
import { QuizService } from './quiz.service';
import { PaginationQueryDto } from './dto/pagination-query.dto';
import { CreateQuizDto } from './dto/create-quiz.dto';
import { BulkCreateQuizzesDto } from './dto/bulk-create-quizzes.dto';
import { CreateUploadSignatureDto } from './dto/create-upload-signature.dto';
import { Roles } from 'src/auth/decorators/roles.decorator';

@Controller('quiz')
export class QuizController {
  constructor(private quizService: QuizService) {}

  @Get()
  async getAllQuizzes(@Query() query: PaginationQueryDto) {
    return this.quizService.getAllQuizzes(query);
  }

  @Get(':id')
  async getQuizById(@Param('id') id: string) {
    return this.quizService.getQuizById(id);
  }

  @Get('code/:code')
  async getQuizByCode(@Param('code') code: string) {
    return this.quizService.getQuizByCode(code);
  }

  @Roles('admin')
  @Post('upload/signature')
  async createImageUploadSignature(@Body() dto: CreateUploadSignatureDto) {
    return this.quizService.createImageUploadSignature(dto);
  }

  @Roles('admin')
  @Post('bulk')
  async createQuizzes(@Body() data: BulkCreateQuizzesDto) {
    return this.quizService.createQuizzes(data);
  }

  @Roles('admin')
  @Post()
  async createQuiz(@Body() data: CreateQuizDto) {
    return this.quizService.createQuiz(data);
  }

  @Roles('admin')
  @Put(':id')
  async updateQuiz(@Param('id') id: string, @Body() data: any) {
    return this.quizService.updateQuiz(id, data);
  }

  @Roles('admin')
  @Delete(':id')
  async deleteQuiz(@Param('id') id: string) {
    return this.quizService.deleteQuiz(id);
  }
}
