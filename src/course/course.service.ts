import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProjectSubmissionStatus } from '@prisma/client';
import type { Request as ExpressRequest } from 'express';
import { extname } from 'path';
import { CreateCourseDto } from './dto/create-course.dto';
import { CreateProjectSubmissionDto } from './dto/create-project-submission.dto';
import { CreateUploadSignatureDto } from './dto/create-upload-signature.dto';
import { ListProjectSubmissionsQueryDto } from './dto/list-project-submissions-query.dto';
import { PaginationQueryDto } from './dto/pagination-query.dto';
import { ProjectSubmissionFileMetadataDto } from './dto/project-submission-file-metadata.dto';
import { ReviewDecision, ReviewProjectSubmissionDto } from './dto/review-project-submission.dto';
import { UpdateProjectSubmissionDto } from './dto/update-project-submission.dto';
import { UpdateCourseTopicsDto } from './dto/update-course-topics.dto';
import { UpdateCourseDto } from './dto/update-course.dto';
import { UpsertCourseProjectDto } from './dto/upsert-course-project.dto';
import { PrismaService } from '../prisma/prisma.service';
import { CourseProgressService } from './course-progress.service';
import { CloudinaryService } from '../common/storage/cloudinary.service';

const ALLOWED_UPLOAD_EXTENSIONS = new Set(['.zip', '.rar', '.pdf', '.docx']);
const MAX_PROJECT_FILES = 5;
const MAX_PROJECT_FILE_SIZE = 20 * 1024 * 1024;

type ProjectSubmissionWithFiles = Prisma.ProjectSubmissionGetPayload<{
  include: {
    files: true;
  };
}>;

type ValidatedProjectFileMetadata = {
  secureUrl: string;
  publicId: string;
  originalName: string;
  mimeType?: string;
  fileSize?: number;
};

@Injectable()
export class CourseService {
  private readonly logger = new Logger(CourseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly courseProgressService: CourseProgressService,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  async getAllCourses(query: PaginationQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.course.findMany({
        skip,
        take: limit,
        orderBy: {
          createdAt: 'desc',
        },
        include: {
          _count: {
            select: {
              topics: true,
              submissions: true,
              certificates: true,
            },
          },
          projectRequirement: true,
        },
      }),
      this.prisma.course.count(),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrevious: page > 1,
      },
    };
  }

  async getCourseById(id: string) {
    const course = await this.prisma.course.findUnique({
      where: { id },
      include: {
        topics: {
          orderBy: {
            sortOrder: 'asc',
          },
          include: {
            topic: true,
          },
        },
        projectRequirement: true,
      },
    });

    if (!course) {
      throw new NotFoundException(`Course with id '${id}' was not found`);
    }

    return course;
  }

  async getCourseBySlug(slug: string) {
    const course = await this.prisma.course.findUnique({
      where: { slug },
      include: {
        topics: {
          orderBy: {
            sortOrder: 'asc',
          },
          include: {
            topic: true,
          },
        },
        projectRequirement: true,
      },
    });

    if (!course) {
      throw new NotFoundException(`Course with slug '${slug}' was not found`);
    }

    return course;
  }

  async getCourseTopics(courseId: string, query: PaginationQueryDto) {
    await this.ensureCourseExists(courseId);

    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.courseTopic.findMany({
        where: { courseId },
        skip,
        take: limit,
        orderBy: {
          sortOrder: 'asc',
        },
        include: {
          topic: {
            include: {
              _count: {
                select: {
                  quizzes: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.courseTopic.count({
        where: { courseId },
      }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrevious: page > 1,
      },
    };
  }

  async createCourse(data: CreateCourseDto) {
    await this.ensureCourseSlugUnique(data.slug);

    const hasProject = Boolean(data.hasProject);

    const topicWeight = hasProject ? 50 : 100;
    const projectWeight = hasProject ? 50 : 0;

    return this.prisma.course.create({
      data: {
        name: data.name,
        slug: data.slug,
        description: data.description,
        hasProject,
        topicWeight: data.topicWeight ?? topicWeight,
        projectWeight: data.projectWeight ?? projectWeight,
      },
    });
  }

  async updateCourse(id: string, data: UpdateCourseDto) {
    await this.ensureCourseExists(id);

    if (data.slug) {
      await this.ensureCourseSlugUnique(data.slug, id);
    }

    const hasProject = data.hasProject;

    return this.prisma.course.update({
      where: { id },
      data: {
        ...data,
        ...(typeof hasProject === 'boolean'
          ? {
              topicWeight: data.topicWeight ?? (hasProject ? 50 : 100),
              projectWeight: data.projectWeight ?? (hasProject ? 50 : 0),
            }
          : {}),
      },
    });
  }

  async deleteCourse(id: string) {
    await this.ensureCourseExists(id);

    return this.prisma.course.delete({
      where: { id },
    });
  }

  async updateCourseTopics(courseId: string, data: UpdateCourseTopicsDto) {
    await this.ensureCourseExists(courseId);
    await this.ensureTopicsExist(data.topicIds);

    const uniqueTopicIds = [...new Set(data.topicIds)];

    await this.prisma.$transaction(async (tx) => {
      await tx.courseTopic.deleteMany({
        where: { courseId },
      });

      await tx.courseTopic.createMany({
        data: uniqueTopicIds.map((topicId, index) => ({
          courseId,
          topicId,
          sortOrder: index + 1,
        })),
      });
    });

    return this.getCourseById(courseId);
  }

  async createTopicForCourse(
    courseId: string,
    data: { name: string; slug: string },
  ) {
    await this.ensureCourseExists(courseId);
    await this.ensureTopicSlugUnique(data.slug);

    return this.prisma.$transaction(async (tx) => {
      const topic = await tx.topic.create({
        data: {
          name: data.name,
          slug: data.slug,
        },
      });

      const lastLink = await tx.courseTopic.findFirst({
        where: { courseId },
        orderBy: { sortOrder: 'desc' },
        select: { sortOrder: true },
      });

      await tx.courseTopic.create({
        data: {
          courseId,
          topicId: topic.id,
          sortOrder: (lastLink?.sortOrder ?? 0) + 1,
        },
      });

      return topic;
    });
  }

  async upsertProjectRequirement(courseId: string, data: UpsertCourseProjectDto) {
    const course = await this.ensureCourseExists(courseId);
    const normalizedDescription = data.description.trim();

    if (!normalizedDescription) {
      throw new BadRequestException('Project description is required');
    }

    const requirement = await this.prisma.courseProjectRequirement.upsert({
      where: { courseId },
      update: {
        title: data.title,
        description: normalizedDescription,
        isRequired: data.isRequired ?? true,
      },
      create: {
        courseId,
        title: data.title,
        description: normalizedDescription,
        isRequired: data.isRequired ?? true,
      },
    });

    if (!course.hasProject) {
      await this.prisma.course.update({
        where: { id: courseId },
        data: {
          hasProject: true,
          topicWeight: 50,
          projectWeight: 50,
        },
      });
    }

    return requirement;
  }

  async createUploadSignature(
    courseId: string,
    req: ExpressRequest,
    dto: CreateUploadSignatureDto,
  ) {
    const userId = this.extractUserId(req);
    const course = await this.ensureCourseExists(courseId);

    if (!course.hasProject) {
      throw new BadRequestException('This course does not require a project');
    }

    const folder = this.getProjectSubmissionFolder(courseId, userId);
    const timestamp = Math.floor(Date.now() / 1000);
    const publicId = dto.publicId?.trim() ? this.sanitizePublicId(dto.publicId) : undefined;

    return this.cloudinaryService.createUploadSignature({
      timestamp,
      folder,
      publicId,
    });
  }

  async submitProject(
    courseId: string,
    req: ExpressRequest,
    data: CreateProjectSubmissionDto,
  ) {
    const userId = this.extractUserId(req);
    const course = await this.ensureCourseExists(courseId);

    if (!course.hasProject) {
      throw new BadRequestException('This course does not require a project');
    }

    const requirement = await this.prisma.courseProjectRequirement.findUnique({
      where: { courseId },
    });

    if (!requirement) {
      throw new BadRequestException('Project requirement is not configured for this course');
    }

    if (!requirement.description?.trim()) {
      throw new BadRequestException('Project requirement must include a description');
    }

    const existingSubmission = await this.prisma.projectSubmission.findFirst({
      where: {
        courseId,
        userId,
      },
      select: {
        id: true,
      },
    });

    if (existingSubmission) {
      throw new ConflictException(
        'You have already submitted this project. Please update the existing submission.',
      );
    }

    const uploadedCloudFiles = this.normalizeAndValidateSubmissionFiles(
      data.files,
      courseId,
      userId,
    );

    let submission: ProjectSubmissionWithFiles;

    try {
      submission = await this.prisma.projectSubmission.create({
        data: {
          userId,
          courseId,
          requirementId: requirement.id,
          note: data.note ?? null,
          status: ProjectSubmissionStatus.PENDING_REVIEW,
          files: {
            create: uploadedCloudFiles.map((file, index) => ({
              filePath: file.secureUrl,
              storageKey: file.publicId,
              originalName: file.originalName,
              mimeType: file.mimeType,
              fileSize: file.fileSize,
              sortOrder: index + 1,
            })),
          },
        },
        include: {
          files: true,
        },
      });
    } catch (error) {
      await this.deleteCloudinaryFiles(uploadedCloudFiles.map((file) => file.publicId));
      throw error;
    }

    await this.courseProgressService.evaluateCourseProgress(userId, courseId, req);

    return this.mapProjectSubmission(submission);
  }

  async getMySubmission(courseId: string, req: ExpressRequest) {
    const userId = this.extractUserId(req);
    await this.ensureCourseExists(courseId);

    const submission = await this.prisma.projectSubmission.findFirst({
      where: {
        courseId,
        userId,
      },
      orderBy: {
        submittedAt: 'desc',
      },
      include: {
        files: true,
      },
    });

    return submission ? this.mapProjectSubmission(submission) : null;
  }

  async updateProjectSubmission(
    courseId: string,
    submissionId: string,
    req: ExpressRequest,
    data: UpdateProjectSubmissionDto,
  ) {
    const userId = this.extractUserId(req);

    const submission = await this.prisma.projectSubmission.findFirst({
      where: {
        id: submissionId,
        courseId,
        userId,
      },
      include: {
        files: true,
      },
    });

    if (!submission) {
      throw new NotFoundException(`Submission with id '${submissionId}' was not found`);
    }

    if (submission.status !== ProjectSubmissionStatus.PENDING_REVIEW) {
      throw new BadRequestException('Only pending submissions can be updated');
    }

    const uploadedFiles = data.files ?? [];
    const removeTargets = this.normalizeRemoveTargets(data.removeFiles);

    const hasFileUpdate = uploadedFiles.length > 0 || removeTargets.length > 0;
    const hasNoteUpdate = typeof data.note !== 'undefined';

    if (!hasFileUpdate && !hasNoteUpdate) {
      throw new BadRequestException('Provide files or note to update submission');
    }

    const targetFileSet = new Set(removeTargets);
    const unresolvedTargets = removeTargets.filter(
      (target) =>
        !submission.files.some(
          (file) =>
            file.id === target ||
            file.filePath === target ||
            (file.storageKey ? file.storageKey === target : false),
        ),
    );

    if (unresolvedTargets.length > 0) {
      throw new BadRequestException(
        `Some files could not be found in this submission: ${unresolvedTargets.join(', ')}`,
      );
    }

    const filesToDelete = submission.files.filter(
      (file) =>
        targetFileSet.has(file.id) ||
        targetFileSet.has(file.filePath) ||
        (file.storageKey ? targetFileSet.has(file.storageKey) : false),
    );

    const finalFileCount = submission.files.length - filesToDelete.length + uploadedFiles.length;

    if (finalFileCount === 0) {
      throw new BadRequestException('At least one file is required');
    }

    if (finalFileCount > MAX_PROJECT_FILES) {
      throw new BadRequestException(`A maximum of ${MAX_PROJECT_FILES} files is allowed`);
    }

    const nextNote = hasNoteUpdate ? data.note ?? null : submission.note;
    const updateInput: Prisma.ProjectSubmissionUpdateInput = {
      note: nextNote,
    };

    const uploadedCloudFiles = hasFileUpdate
      ? this.normalizeAndValidateSubmissionFiles(uploadedFiles, courseId, userId)
      : [];

    let updated: ProjectSubmissionWithFiles;

    try {
      updated = await this.prisma.$transaction(async (tx) => {
        const updatedSubmission = await tx.projectSubmission.update({
          where: { id: submission.id },
          data: updateInput,
        });

        if (hasFileUpdate) {
          if (filesToDelete.length > 0) {
            await tx.projectSubmissionFile.deleteMany({
              where: {
                id: {
                  in: filesToDelete.map((file) => file.id),
                },
              },
            });
          }

          const keptFiles = submission.files
            .filter((file) => !targetFileSet.has(file.id))
            .sort((a, b) => a.sortOrder - b.sortOrder);

          for (let index = 0; index < keptFiles.length; index += 1) {
            await tx.projectSubmissionFile.update({
              where: { id: keptFiles[index].id },
              data: { sortOrder: index + 1 },
            });
          }

          for (let index = 0; index < uploadedCloudFiles.length; index += 1) {
            const file = uploadedCloudFiles[index];
            await tx.projectSubmissionFile.create({
              data: {
                submissionId: submission.id,
                filePath: file.secureUrl,
                storageKey: file.publicId,
                originalName: file.originalName,
                mimeType: file.mimeType,
                fileSize: file.fileSize,
                sortOrder: keptFiles.length + index + 1,
              },
            });
          }
        }

        return tx.projectSubmission.findUniqueOrThrow({
          where: { id: updatedSubmission.id },
          include: {
            files: true,
          },
        });
      });
    } catch (error) {
      if (uploadedCloudFiles.length > 0) {
        await this.deleteCloudinaryFiles(uploadedCloudFiles.map((file) => file.publicId));
      }
      throw error;
    }

    if (filesToDelete.length > 0) {
      const oldStorageKeys = filesToDelete
        .map((file) => file.storageKey)
        .filter((key): key is string => Boolean(key));
      await this.deleteCloudinaryFiles(oldStorageKeys);
    }

    return this.mapProjectSubmission(updated);
  }

  async deleteProjectSubmission(
    courseId: string,
    submissionId: string,
    req: ExpressRequest,
  ) {
    const userId = this.extractUserId(req);

    const submission = await this.prisma.projectSubmission.findFirst({
      where: {
        id: submissionId,
        courseId,
        userId,
      },
      select: {
        id: true,
        status: true,
        files: {
          select: {
            storageKey: true,
          },
        },
      },
    });

    if (!submission) {
      throw new NotFoundException(`Submission with id '${submissionId}' was not found`);
    }

    if (submission.status !== ProjectSubmissionStatus.PENDING_REVIEW) {
      throw new BadRequestException('Only pending submissions can be deleted');
    }

    await this.prisma.projectSubmission.delete({
      where: { id: submission.id },
    });

    const storageKeys = submission.files
      .map((file) => file.storageKey)
      .filter((key): key is string => Boolean(key));
    await this.deleteCloudinaryFiles(storageKeys);

    return {
      id: submission.id,
      deleted: true,
    };
  }

  async listProjectSubmissions(
    courseId: string,
    query: ListProjectSubmissionsQueryDto,
  ) {
    await this.ensureCourseExists(courseId);

    const submissions = await this.prisma.projectSubmission.findMany({
      where: {
        courseId,
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: {
        submittedAt: 'desc',
      },
      include: {
        files: true,
      },
    });

    return submissions.map((submission) => this.mapProjectSubmission(submission));
  }

  async reviewProjectSubmission(
    courseId: string,
    submissionId: string,
    dto: ReviewProjectSubmissionDto,
    req: ExpressRequest,
  ) {
    const reviewerId = this.extractUserId(req);

    const submission = await this.prisma.projectSubmission.findFirst({
      where: {
        id: submissionId,
        courseId,
      },
    });

    if (!submission) {
      throw new NotFoundException(`Submission with id '${submissionId}' was not found`);
    }

    const nextStatus =
      dto.decision === ReviewDecision.APPROVE
        ? ProjectSubmissionStatus.APPROVED
        : ProjectSubmissionStatus.REJECTED;

    const updated = await this.prisma.projectSubmission.update({
      where: {
        id: submission.id,
      },
      data: {
        status: nextStatus,
        reviewerId,
        reviewerNote: dto.reviewerNote,
        reviewedAt: new Date(),
      },
      include: {
        files: true,
      },
    });

    // Metadata sync to /users/me requires user context, so reevaluation here skips remote sync.
    await this.courseProgressService.evaluateCourseProgress(submission.userId, courseId);

    return this.mapProjectSubmission(updated);
  }

  async getMyCourseProgress(courseId: string, req: ExpressRequest) {
    const userId = this.extractUserId(req);
    await this.ensureCourseExists(courseId);

    await this.courseProgressService.evaluateCourseProgress(userId, courseId, req);

    const [progress, latestSubmission] = await Promise.all([
      this.prisma.userCourseProgress.findUnique({
        where: {
          userId_courseId: {
            userId,
            courseId,
          },
        },
      }),
      this.prisma.projectSubmission.findFirst({
        where: {
          userId,
          courseId,
        },
        orderBy: {
          submittedAt: 'desc',
        },
        include: {
          files: true,
        },
      }),
    ]);

    return {
      progress,
      latestSubmission: latestSubmission
        ? this.mapProjectSubmission(latestSubmission)
        : null,
    };
  }

  private mapProjectSubmission(submission: ProjectSubmissionWithFiles) {
    const relationFilePaths = [...submission.files]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((file) => file.filePath);
    const files = [...new Set(relationFilePaths)];

    const { files: _files, ...rest } = submission;

    return {
      ...rest,
      files,
    };
  }

  private getProjectSubmissionFolder(courseId: string, userId: string): string {
    const baseFolder = (process.env.CLOUDINARY_PROJECT_FOLDER ?? 'project-submissions')
      .replace(/^\/+|\/+$/g, '');

    return `${baseFolder}/${courseId}/${userId}`;
  }

  private sanitizePublicId(input: string): string {
    const trimmed = input.trim();
    const sanitized = trimmed.replace(/[^a-zA-Z0-9/_-]/g, '_').replace(/^\/+|\/+$/g, '');

    if (!sanitized) {
      throw new BadRequestException('publicId is invalid');
    }

    return sanitized;
  }

  private normalizeAndValidateSubmissionFiles(
    files: ProjectSubmissionFileMetadataDto[],
    courseId: string,
    userId: string,
  ): ValidatedProjectFileMetadata[] {
    if (files.length === 0) {
      throw new BadRequestException('At least one file is required');
    }

    if (files.length > MAX_PROJECT_FILES) {
      throw new BadRequestException(`A maximum of ${MAX_PROJECT_FILES} files is allowed`);
    }

    const folder = this.getProjectSubmissionFolder(courseId, userId);
    const { cloudName } = this.cloudinaryService.getCloudinaryConfig();
    const seenSecureUrls = new Set<string>();
    const seenPublicIds = new Set<string>();

    return files.map((file) => {
      const secureUrl = file.secureUrl.trim();
      const publicId = this.sanitizePublicId(file.publicId);
      const originalName = file.originalName.trim();
      const mimeType = file.mimeType.trim();
      const fileSize = file.fileSize;

      if (!originalName) {
        throw new BadRequestException('originalName is required');
      }

      const extension = extname(originalName).toLowerCase();
      if (!ALLOWED_UPLOAD_EXTENSIONS.has(extension)) {
        throw new BadRequestException('Only zip, rar, pdf, docx files are allowed');
      }

      if (!mimeType) {
        throw new BadRequestException('mimeType is required');
      }

      if (fileSize < 1 || fileSize > MAX_PROJECT_FILE_SIZE) {
        throw new BadRequestException('File size must be between 1 byte and 20MB');
      }

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(secureUrl);
      } catch {
        throw new BadRequestException(`Invalid secureUrl: ${secureUrl}`);
      }

      if (parsedUrl.protocol !== 'https:' || !parsedUrl.hostname.endsWith('res.cloudinary.com')) {
        throw new BadRequestException('secureUrl must be a valid Cloudinary https URL');
      }

      if (!parsedUrl.pathname.includes(`/${cloudName}/`)) {
        throw new BadRequestException('secureUrl does not belong to configured Cloudinary cloud');
      }

      if (!publicId.startsWith(`${folder}/`)) {
        throw new BadRequestException('publicId does not belong to the expected course upload folder');
      }

      if (seenSecureUrls.has(secureUrl)) {
        throw new BadRequestException('Duplicate secureUrl detected in files payload');
      }

      if (seenPublicIds.has(publicId)) {
        throw new BadRequestException('Duplicate publicId detected in files payload');
      }

      seenSecureUrls.add(secureUrl);
      seenPublicIds.add(publicId);

      return {
        secureUrl,
        publicId,
        originalName,
        mimeType,
        fileSize,
      };
    });
  }

  private async deleteCloudinaryFiles(storageKeys: string[]): Promise<void> {
    await Promise.all(
      storageKeys.map(async (key) => {
        try {
          await this.cloudinaryService.deleteRawFile(key);
        } catch (error) {
          this.logger.warn(`Failed to delete Cloudinary asset '${key}'`);
        }
      }),
    );
  }

  private async ensureCourseExists(courseId: string) {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
    });

    if (!course) {
      throw new NotFoundException(`Course with id '${courseId}' was not found`);
    }

    return course;
  }

  private async ensureCourseSlugUnique(slug: string, currentCourseId?: string) {
    const existing = await this.prisma.course.findFirst({
      where: {
        slug,
        ...(currentCourseId ? { id: { not: currentCourseId } } : {}),
      },
      select: {
        id: true,
      },
    });

    if (existing) {
      throw new ConflictException(`Course slug '${slug}' already exists`);
    }
  }

  private async ensureTopicsExist(topicIds: string[]) {
    const uniqueIds = [...new Set(topicIds)];

    const count = await this.prisma.topic.count({
      where: {
        id: {
          in: uniqueIds,
        },
      },
    });

    if (count !== uniqueIds.length) {
      throw new NotFoundException('Some topic ids do not exist');
    }
  }

  private async ensureTopicSlugUnique(slug: string) {
    const existing = await this.prisma.topic.findFirst({
      where: { slug },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException(`Topic slug '${slug}' already exists`);
    }
  }

  private extractUserId(req: ExpressRequest): string {
    const user = (req as ExpressRequest & { user?: any }).user;

    const candidates = [
      user?.id,
      user?.sub,
      user?.user?.id,
      user?.data?.id,
      user?.data?.user?.id,
    ];

    const userId = candidates.find(
      (value): value is string =>
        typeof value === 'string' && value.trim().length > 0,
    );

    if (!userId) {
      throw new ForbiddenException('Unable to resolve authenticated user id');
    }

    return userId;
  }

  private normalizeRemoveTargets(rawTargets?: string[]): string[] {
    if (!rawTargets) {
      return [];
    }

    return [...new Set(rawTargets.map((item) => item.trim()).filter((item) => item.length > 0))];
  }
}
