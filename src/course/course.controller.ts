import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Request,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { extname } from 'path';
import { memoryStorage } from 'multer';
import type { Request as ExpressRequest } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { CourseService } from './course.service';
import { CreateCourseDto } from './dto/create-course.dto';
import { ListProjectSubmissionsQueryDto } from './dto/list-project-submissions-query.dto';
import { PaginationQueryDto } from './dto/pagination-query.dto';
import { ReviewProjectSubmissionDto } from './dto/review-project-submission.dto';
import { UpdateCourseTopicsDto } from './dto/update-course-topics.dto';
import { UpdateCourseDto } from './dto/update-course.dto';
import { UpsertCourseProjectDto } from './dto/upsert-course-project.dto';

const storage = memoryStorage();

const allowedExtensions = new Set(['.zip', '.rar', '.pdf', '.docx']);

const fileFilter = (
  _req: ExpressRequest,
  file: Express.Multer.File,
  cb: (error: Error | null, acceptFile: boolean) => void,
) => {
  const extension = extname(file.originalname).toLowerCase();
  if (!allowedExtensions.has(extension)) {
    cb(new Error('Only zip, rar, pdf, docx files are allowed'), false);
    return;
  }

  cb(null, true);
};

@Controller('course')
export class CourseController {
  constructor(private readonly courseService: CourseService) {}

  @Get()
  async getAllCourses(@Query() query: PaginationQueryDto) {
    return this.courseService.getAllCourses(query);
  }

  @Get('slug/:slug')
  async getCourseBySlug(@Param('slug') slug: string) {
    return this.courseService.getCourseBySlug(slug);
  }

  @Get(':id/topics')
  async getCourseTopics(
    @Param('id') id: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.courseService.getCourseTopics(id, query);
  }

  @Get(':id')
  async getCourseById(@Param('id') id: string) {
    return this.courseService.getCourseById(id);
  }

  @Get(':id/progress/me')
  async getMyCourseProgress(
    @Param('id') id: string,
    @Request() req: ExpressRequest,
  ) {
    return this.courseService.getMyCourseProgress(id, req);
  }

  @Get(':id/project-submission/me')
  async getMySubmission(
    @Param('id') id: string,
    @Request() req: ExpressRequest,
  ) {
    return this.courseService.getMySubmission(id, req);
  }

  @Roles('admin')
  @Get(':id/project-submission')
  async listProjectSubmissions(
    @Param('id') id: string,
    @Query() query: ListProjectSubmissionsQueryDto,
  ) {
    return this.courseService.listProjectSubmissions(id, query);
  }

  @Roles('admin')
  @Post()
  async createCourse(@Body() data: CreateCourseDto) {
    return this.courseService.createCourse(data);
  }

  @Roles('admin')
  @Put(':id')
  async updateCourse(@Param('id') id: string, @Body() data: UpdateCourseDto) {
    return this.courseService.updateCourse(id, data);
  }

  @Roles('admin')
  @Delete(':id')
  async deleteCourse(@Param('id') id: string) {
    return this.courseService.deleteCourse(id);
  }

  @Roles('admin')
  @Put(':id/topics')
  async updateCourseTopics(
    @Param('id') id: string,
    @Body() data: UpdateCourseTopicsDto,
  ) {
    return this.courseService.updateCourseTopics(id, data);
  }

  @Roles('admin')
  @Put(':id/project-requirement')
  async upsertProjectRequirement(
    @Param('id') id: string,
    @Body() data: UpsertCourseProjectDto,
  ) {
    return this.courseService.upsertProjectRequirement(id, data);
  }

  @Post(':id/project-submission')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'files', maxCount: 5 },
      ],
      {
        storage,
        fileFilter,
        limits: {
          fileSize: 20 * 1024 * 1024,
        },
      },
    ),
  )
  async submitProject(
    @Param('id') id: string,
    @UploadedFiles()
    files: {
      files?: Express.Multer.File[];
    },
    @Body('note') note: string | undefined,
    @Request() req: ExpressRequest,
  ) {
    return this.courseService.submitProject(id, req, files, note);
  }

  @Patch(':id/project-submission/:submissionId')
  @UseInterceptors(
    FileFieldsInterceptor(
      [{ name: 'files', maxCount: 5 }],
      {
        storage,
        fileFilter,
        limits: {
          fileSize: 20 * 1024 * 1024,
        },
      },
    ),
  )
  async updateProjectSubmission(
    @Param('id') id: string,
    @Param('submissionId') submissionId: string,
    @UploadedFiles()
    files: {
      files?: Express.Multer.File[];
    },
    @Body('note') note: string | undefined,
    @Body('removeFiles') removeFiles: string | string[] | undefined,
    @Request() req: ExpressRequest,
  ) {
    return this.courseService.updateProjectSubmission(
      id,
      submissionId,
      req,
      files,
      note,
      removeFiles,
    );
  }

  @Delete(':id/project-submission/:submissionId')
  async deleteProjectSubmission(
    @Param('id') id: string,
    @Param('submissionId') submissionId: string,
    @Request() req: ExpressRequest,
  ) {
    return this.courseService.deleteProjectSubmission(id, submissionId, req);
  }

  @Roles('admin')
  @Patch(':id/project-submission/:submissionId/review')
  async reviewProjectSubmission(
    @Param('id') id: string,
    @Param('submissionId') submissionId: string,
    @Body() data: ReviewProjectSubmissionDto,
    @Request() req: ExpressRequest,
  ) {
    return this.courseService.reviewProjectSubmission(id, submissionId, data, req);
  }
}
