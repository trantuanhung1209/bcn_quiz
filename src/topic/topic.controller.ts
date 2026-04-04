import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { TopicService } from './topic.service';
import { CreateTopicDto } from './dto/create-topic.dto';
import { UpdateTopicDto } from './dto/update-topic.dto';
import { PaginationQueryDto } from './dto/pagination-query.dto';
import { Roles } from 'src/auth/decorators/roles.decorator';

@Controller('topic')
export class TopicController {
  constructor(private readonly topicService: TopicService) {}

  @Get(':id/quizzes')
  async getQuizzesByTopicId(
    @Param('id') id: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.topicService.getQuizzesByTopicId(id, query);
  }

  @Get('slug/:slug/quizzes')
  async getQuizzesByTopicSlug(
    @Param('slug') slug: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.topicService.getQuizzesByTopicSlug(slug, query);
  }

  @Get()
  async getAllTopics(@Query() query: PaginationQueryDto) {
    return this.topicService.getAllTopics(query);
  }

  @Get(':id')
  async getTopicById(@Param('id') id: string) {
    return this.topicService.getTopicById(id);
  }

  @Get('slug/:slug')
  async getTopicBySlug(@Param('slug') slug: string) {
    return this.topicService.getTopicBySlug(slug);
  }

  @Roles('admin')
  @Post()
  async createTopic(@Body() data: CreateTopicDto) {
    return this.topicService.createTopic(data);
  }

  @Roles('admin')
  @Put(':id')
  async updateTopic(@Param('id') id: string, @Body() data: UpdateTopicDto) {
    return this.topicService.updateTopic(id, data);
  }

  @Roles('admin')
  @Delete(':id')
  async deleteTopic(@Param('id') id: string) {
    return this.topicService.deleteTopic(id);
  }
}
