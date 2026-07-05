import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CloudinaryService } from '../common/storage/cloudinary.service';
import { PaginationQueryDto } from './dto/pagination-query.dto';
import { CreateQuizDto } from './dto/create-quiz.dto';
import { CreateUploadSignatureDto } from './dto/create-upload-signature.dto';

type RawQuiz = {
  id: string;
  quizCode: string;
  content: {
    text: string;
    code: string;
    has_code: boolean;
    image: string | null;
    has_image: boolean;
  };
  options: {
    is_code: boolean;
    data: Record<string, string>;
  };
  answer: string;
  explanation: string;
  imagePublicId: string | null;
};

function mapQuiz(raw: RawQuiz) {
  return {
    id: raw.id,
    quizCode: raw.quizCode,
    content: {
      text: raw.content.text,
      code: raw.content.code,
      has_code: raw.content.has_code,
      image: raw.content.image,
      has_image: raw.content.has_image,
    },
    options: {
      is_code: raw.options.is_code,
      data: raw.options.data,
    },
    answer: raw.answer,
    explanation: raw.explanation,
    imagePublicId: raw.imagePublicId,
  };
}

/** Public variant — omits answer and explanation for quiz-taking endpoints */
function mapQuizPublic(raw: RawQuiz) {
  return {
    id: raw.id,
    quizCode: raw.quizCode,
    content: {
      text: raw.content.text,
      code: raw.content.code,
      has_code: raw.content.has_code,
      image: raw.content.image,
      has_image: raw.content.has_image,
    },
    options: {
      is_code: raw.options.is_code,
      data: raw.options.data,
    },
  };
}

function toRawQuiz(quiz: any): RawQuiz {
  return {
    id: quiz.id,
    quizCode: quiz.quizCode,
    content: {
      text: quiz.question,
      code: quiz.code ?? '',
      has_code: Boolean(quiz.code),
      image: quiz.imageUrl ?? null,
      has_image: Boolean(quiz.imageUrl),
    },
    options: {
      is_code: (quiz.options ?? []).some((option: any) => option.isCode),
      data: Object.fromEntries(
        (quiz.options ?? []).map((option: any) => [option.label, option.content]),
      ),
    },
    answer: quiz.answer,
    explanation: quiz.explanation ?? '',
    imagePublicId: quiz.imagePublicId ?? null,
  };
}

function normalizeQuizInput(data: any) {
  if (data?.content && data?.options?.data) {
    return {
      quizCode: data.quizCode ?? data.id,
      question: data.content.text,
      code: data.content.has_code ? data.content.code : null,
      explanation: data.explanation ?? null,
      answer: data.answer,
      topicId: data.topicId,
      imageUrl: data.imageUrl ?? data.content.image ?? null,
      imagePublicId: data.imagePublicId ?? null,
      options: Object.entries(data.options.data).map(([label, content]) => ({
        label,
        content,
        isCode: data.options.is_code ?? false,
      })),
    };
  }

  return {
    quizCode: data.quizCode,
    question: data.question,
    code: data.code ?? null,
    explanation: data.explanation ?? null,
    answer: data.answer,
    topicId: data.topicId,
    imageUrl: data.imageUrl ?? null,
    imagePublicId: data.imagePublicId ?? null,
    options: (data.options ?? []).map((option: any) => ({
      label: option.label,
      content: option.content,
      isCode: option.isCode ?? false,
    })),
  };
}

@Injectable()
export class QuizService {
  private readonly logger = new Logger(QuizService.name);

  constructor(
    private prisma: PrismaService,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  private async validateQuizInput(
    quizCode: string | undefined,
    topicId: string | undefined,
    currentQuizId?: string,
    answer?: string,
    optionLabels?: string[],
  ): Promise<void> {
    if (!quizCode?.trim()) {
      throw new BadRequestException('quizCode is required');
    }

    if (!topicId?.trim()) {
      throw new BadRequestException('topicId is required');
    }

    if (answer && optionLabels && optionLabels.length > 0) {
      if (!optionLabels.includes(answer)) {
        throw new BadRequestException(
          `answer '${answer}' must match one of the option labels: ${optionLabels.join(', ')}`,
        );
      }
    }

    const existingQuiz = await this.prisma.quiz.findFirst({
      where: {
        topicId,
        quizCode,
        ...(currentQuizId ? { id: { not: currentQuizId } } : {}),
      },
      select: { id: true },
    });

    if (existingQuiz) {
      throw new ConflictException(
        `quizCode '${quizCode}' already exists in this topic`,
      );
    }

    const existingTopic = await this.prisma.topic.findUnique({
      where: { id: topicId },
      select: { id: true },
    });

    if (!existingTopic) {
      throw new NotFoundException(`Topic with id '${topicId}' was not found`);
    }
  }

  async getAllQuizzes(query: PaginationQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const skip = (page - 1) * limit;

    const [quizzes, total] = await Promise.all([
      this.prisma.quiz.findMany({
        skip,
        take: limit,
        orderBy: {
          createdAt: 'desc',
        },
        include: {
          topic: true,
          options: true,
        },
      }),
      this.prisma.quiz.count(),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));

    return {
      items: quizzes.map((quiz) => mapQuizPublic(toRawQuiz(quiz))),
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

  async getQuizById(id: string) {
    const quiz = await this.prisma.quiz.findUnique({
      where: { id },
      include: {
        topic: true,
        options: true,
      },
    });

    return quiz ? mapQuizPublic(toRawQuiz(quiz)) : null;
  }

  async getQuizByCode(quizCode: string) {
    const quiz = await this.prisma.quiz.findFirst({
      where: { quizCode },
      orderBy: { createdAt: 'desc' },
      include: {
        topic: true,
        options: true,
      },
    });

    return quiz ? mapQuizPublic(toRawQuiz(quiz)) : null;
  }

  async createQuiz(data: CreateQuizDto) {
    const input = normalizeQuizInput(data);
    const optionLabels = input.options.map((o: any) => o.label);
    await this.validateQuizInput(input.quizCode, input.topicId, undefined, input.answer, optionLabels);
    this.validateImageFields(input.imageUrl, input.imagePublicId);

    const quiz = await this.prisma.quiz.create({
      data: {
        quizCode: input.quizCode,
        question: input.question,
        code: input.code,
        explanation: input.explanation,
        answer: input.answer,
        imageUrl: input.imageUrl,
        imagePublicId: input.imagePublicId,
        topic: {
          connect: {
            id: input.topicId,
          },
        },
        options: {
          create: input.options.map((option: any) => ({
            label: option.label,
            content: option.content,
            isCode: option.isCode ?? false,
          })),
        },
      },
      include: {
        topic: true,
        options: true,
      },
    });

    return mapQuiz(toRawQuiz(quiz));
  }

  async updateQuiz(id: string, data: any) {
    const input = normalizeQuizInput(data);
    const optionLabels = input.options.map((o: any) => o.label);
    await this.validateQuizInput(input.quizCode, input.topicId, id, input.answer, optionLabels);
    this.validateImageFields(input.imageUrl, input.imagePublicId);

    const existing = await this.prisma.quiz.findUnique({
      where: { id },
      select: { imagePublicId: true },
    });

    if (!existing) {
      throw new NotFoundException(`Quiz with id '${id}' was not found`);
    }

    const quiz = await this.prisma.quiz.update({
      where: { id },
      data: {
        question: input.question,
        code: input.code,
        answer: input.answer,
        explanation: input.explanation,
        imageUrl: input.imageUrl,
        imagePublicId: input.imagePublicId,
        topic: {
          connect: {
            id: input.topicId,
          },
        },
        options: {
          deleteMany: {},
          create: input.options.map((option: any) => ({
            label: option.label,
            content: option.content,
            isCode: option.isCode ?? false,
          })),
        },
      },
      include: {
        topic: true,
        options: true,
      },
    });

    // PUT semantics: ảnh cũ bị thay (hoặc bỏ) thì xoá asset cũ trên Cloudinary
    if (
      existing.imagePublicId &&
      existing.imagePublicId !== input.imagePublicId
    ) {
      await this.deleteQuizImage(existing.imagePublicId);
    }

    return mapQuiz(toRawQuiz(quiz));
  }

  async deleteQuiz(id: string) {
    const existing = await this.prisma.quiz.findUnique({
      where: { id },
      select: { id: true, imagePublicId: true },
    });

    if (!existing) {
      throw new NotFoundException(`Quiz with id '${id}' was not found`);
    }

    const deleted = await this.prisma.quiz.delete({
      where: { id },
    });

    if (existing.imagePublicId) {
      await this.deleteQuizImage(existing.imagePublicId);
    }

    return deleted;
  }

  createImageUploadSignature(dto: CreateUploadSignatureDto) {
    const folder = (
      process.env.CLOUDINARY_QUIZ_IMAGE_FOLDER ?? 'quiz-images'
    ).replace(/^\/+|\/+$/g, '');
    const timestamp = Math.floor(Date.now() / 1000);
    const publicId = dto.publicId?.trim()
      ? this.sanitizePublicId(dto.publicId)
      : undefined;

    return this.cloudinaryService.createUploadSignature({
      timestamp,
      folder,
      publicId,
    });
  }

  private validateImageFields(
    imageUrl?: string | null,
    imagePublicId?: string | null,
  ): void {
    if ((imageUrl && !imagePublicId) || (!imageUrl && imagePublicId)) {
      throw new BadRequestException(
        'imageUrl and imagePublicId must be provided together',
      );
    }

    if (imageUrl) {
      const { cloudName } = this.cloudinaryService.getCloudinaryConfig();
      let parsed: URL;
      try {
        parsed = new URL(imageUrl);
      } catch {
        throw new BadRequestException('imageUrl is not a valid URL');
      }

      if (
        parsed.protocol !== 'https:' ||
        !parsed.hostname.endsWith('res.cloudinary.com')
      ) {
        throw new BadRequestException(
          'imageUrl must be a valid Cloudinary https URL',
        );
      }

      if (!parsed.pathname.includes(`/${cloudName}/`)) {
        throw new BadRequestException(
          'imageUrl does not belong to the configured Cloudinary cloud',
        );
      }
    }
  }

  private sanitizePublicId(input: string): string {
    const trimmed = input.trim();
    const sanitized = trimmed
      .replace(/[^a-zA-Z0-9/_-]/g, '_')
      .replace(/^\/+|\/+$/g, '');

    if (!sanitized) {
      throw new BadRequestException('publicId is invalid');
    }

    return sanitized;
  }

  private async deleteQuizImage(publicId: string): Promise<void> {
    try {
      await this.cloudinaryService.deleteImage(publicId);
    } catch {
      this.logger.warn(`Failed to delete Cloudinary quiz image '${publicId}'`);
    }
  }
}
