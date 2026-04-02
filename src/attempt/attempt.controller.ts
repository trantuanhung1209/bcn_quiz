import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
} from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { AttemptService } from './attempt.service';
import { SubmitAttemptDto } from './dto/submit-attempt.dto';
import { AttemptQueryDto } from './dto/attempt-query.dto';
import { StartSessionDto } from './dto/start-session.dto';
import { SaveSessionDto } from './dto/save-session.dto';

@Controller()
export class AttemptController {
  constructor(private readonly attemptService: AttemptService) {}

  @Post('topic/:topicId/session/start')
  async startTopicSession(
    @Param('topicId') topicId: string,
    @Body() dto: StartSessionDto,
    @Request() req: ExpressRequest,
  ) {
    return this.attemptService.startTopicSession(topicId, dto, req);
  }

  @Get('topic/:topicId/session/resume')
  async resumeTopicSession(
    @Param('topicId') topicId: string,
    @Request() req: ExpressRequest,
  ) {
    return this.attemptService.resumeTopicSession(topicId, req);
  }

  @Post('attempt/session/:sessionId/save')
  async saveSessionProgress(
    @Param('sessionId') sessionId: string,
    @Body() dto: SaveSessionDto,
    @Request() req: ExpressRequest,
  ) {
    return this.attemptService.saveSessionProgress(sessionId, dto, req);
  }

  @Post('attempt/session/:sessionId/submit')
  async submitSession(
    @Param('sessionId') sessionId: string,
    @Request() req: ExpressRequest,
  ) {
    return this.attemptService.submitSession(sessionId, req);
  }

  @Post('quiz/:id/attempt')
  async submitAttempt(
    @Param('id') id: string,
    @Body() dto: SubmitAttemptDto,
    @Request() req: ExpressRequest,
  ) {
    return this.attemptService.submitAttempt(id, dto, req);
  }

  @Get('attempt/me')
  async getMyAttempts(
    @Query() query: AttemptQueryDto,
    @Request() req: ExpressRequest,
  ) {
    return this.attemptService.getMyAttempts(query, req);
  }

  @Get('attempt/me/:attemptId')
  async getMyAttemptById(
    @Param('attemptId') attemptId: string,
    @Request() req: ExpressRequest,
  ) {
    return this.attemptService.getMyAttemptById(attemptId, req);
  }

  @Get('progress/me')
  async getMyProgress(@Request() req: ExpressRequest) {
    return this.attemptService.getMyProgress(req);
  }

  @Get('progress/me/topic/:topicId')
  async getMyTopicProgress(
    @Param('topicId') topicId: string,
    @Request() req: ExpressRequest,
  ) {
    return this.attemptService.getMyTopicProgress(topicId, req);
  }
}
