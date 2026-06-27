import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PaginationQueryDto } from './dto/pagination-query.dto';
import { CreateQuizDto } from './dto/create-quiz.dto';

type RawQuiz = {
  id: string;
  quizCode: string;
  content: {
    text: string;
    code: string;
    has_code: boolean;
  };
  options: {
    is_code: boolean;
    data: Record<string, string>;
  };
  answer: string;
  explanation: string;
};

function mapQuiz(raw: RawQuiz) {
  return {
    id: raw.id,
    quizCode: raw.quizCode,
    content: {
      text: raw.content.text,
      code: raw.content.code,
      has_code: raw.content.has_code,
    },
    options: {
      is_code: raw.options.is_code,
      data: raw.options.data,
    },
    answer: raw.answer,
    explanation: raw.explanation,
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
    },
    options: {
      is_code: (quiz.options ?? []).some((option: any) => option.isCode),
      data: Object.fromEntries(
        (quiz.options ?? []).map((option: any) => [option.label, option.content]),
      ),
    },
    answer: quiz.answer,
    explanation: quiz.explanation ?? '',
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
    options: (data.options ?? []).map((option: any) => ({
      label: option.label,
      content: option.content,
      isCode: option.isCode ?? false,
    })),
  };
}

@Injectable()
export class QuizService {
  constructor(private prisma: PrismaService) {}

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

    const quiz = await this.prisma.quiz.create({
      data: {
        quizCode: input.quizCode,
        question: input.question,
        code: input.code,
        explanation: input.explanation,
        answer: input.answer,
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

    const quiz = await this.prisma.quiz.update({
      where: { id },
      data: {
        question: input.question,
        code: input.code,
        answer: input.answer,
        explanation: input.explanation,
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

    return mapQuiz(toRawQuiz(quiz));
  }

  async deleteQuiz(id: string) {
    return this.prisma.quiz.delete({
      where: { id },
    });
  }
}
