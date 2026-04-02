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

  @Post()
  async createQuiz(@Body() data: CreateQuizDto) {
    return this.quizService.createQuiz(data);
  }

  @Put(':id')
  async updateQuiz(@Param('id') id: string, @Body() data: any) {
    return this.quizService.updateQuiz(id, data);
  }

  @Delete(':id')
  async deleteQuiz(@Param('id') id: string) {
    return this.quizService.deleteQuiz(id);
  }
}
