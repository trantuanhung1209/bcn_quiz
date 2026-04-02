import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTopicDto } from './dto/create-topic.dto';
import { UpdateTopicDto } from './dto/update-topic.dto';
import { PaginationQueryDto } from './dto/pagination-query.dto';

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

@Injectable()
export class TopicService {
  constructor(private readonly prisma: PrismaService) {}

  async getQuizzesByTopicId(topicId: string, query: PaginationQueryDto) {
    await this.ensureTopicExists(topicId);

    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const skip = (page - 1) * limit;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.quiz.findMany({
        where: {
          topicId,
        },
        skip,
        take: limit,
        orderBy: {
          createdAt: 'desc',
        },
        include: {
          options: true,
        },
      }),
      this.prisma.quiz.count({
        where: {
          topicId,
        },
      }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));

    return {
      items: items.map((quiz) => mapQuiz(toRawQuiz(quiz))),
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

  async getQuizzesByTopicSlug(slug: string, query: PaginationQueryDto) {
    const topic = await this.prisma.topic.findUnique({
      where: { slug },
      select: { id: true },
    });

    if (!topic) {
      throw new NotFoundException(`Topic with slug '${slug}' was not found`);
    }

    return this.getQuizzesByTopicId(topic.id, query);
  }

  async getAllTopics(query: PaginationQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const skip = (page - 1) * limit;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.topic.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: {
            select: {
              quizzes: true,
            },
          },
        },
      }),
      this.prisma.topic.count(),
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

  async getTopicById(id: string) {
    const topic = await this.prisma.topic.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            quizzes: true,
          },
        },
      },
    });

    if (!topic) {
      throw new NotFoundException(`Topic with id '${id}' was not found`);
    }

    return topic;
  }

  async getTopicBySlug(slug: string) {
    const topic = await this.prisma.topic.findUnique({
      where: { slug },
      include: {
        _count: {
          select: {
            quizzes: true,
          },
        },
      },
    });

    if (!topic) {
      throw new NotFoundException(`Topic with slug '${slug}' was not found`);
    }

    return topic;
  }

  async createTopic(data: CreateTopicDto) {
    await this.ensureSlugUnique(data.slug);

    return this.prisma.topic.create({
      data: {
        name: data.name,
        slug: data.slug,
      },
    });
  }

  async updateTopic(id: string, data: UpdateTopicDto) {
    await this.ensureTopicExists(id);

    if (data.slug) {
      await this.ensureSlugUnique(data.slug, id);
    }

    return this.prisma.topic.update({
      where: { id },
      data,
    });
  }

  async deleteTopic(id: string) {
    await this.ensureTopicExists(id);

    return this.prisma.topic.delete({
      where: { id },
    });
  }

  private async ensureSlugUnique(slug: string, currentTopicId?: string) {
    const existing = await this.prisma.topic.findFirst({
      where: {
        slug,
        ...(currentTopicId ? { id: { not: currentTopicId } } : {}),
      },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException(`Topic slug '${slug}' already exists`);
    }
  }

  private async ensureTopicExists(id: string) {
    const existing = await this.prisma.topic.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException(`Topic with id '${id}' was not found`);
    }
  }
}
