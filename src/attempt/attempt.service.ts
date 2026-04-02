import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { AttemptSessionStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SubmitAttemptDto } from './dto/submit-attempt.dto';
import { AttemptQueryDto } from './dto/attempt-query.dto';
import { StartSessionDto } from './dto/start-session.dto';
import { SaveSessionDto } from './dto/save-session.dto';

@Injectable()
export class AttemptService {
  constructor(private readonly prisma: PrismaService) {}

  async startTopicSession(
    topicId: string,
    dto: StartSessionDto,
    req: ExpressRequest,
  ) {
    const userId = this.extractUserId(req);
    await this.ensureTopicExists(topicId);

    const existing = await this.prisma.attemptSession.findFirst({
      where: {
        userId,
        topicId,
        status: AttemptSessionStatus.IN_PROGRESS,
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    if (existing) {
      const expired = await this.expireSessionIfNeeded(existing.id, existing.expiresAt);
      if (!expired) {
        return this.mapSession(existing);
      }
    }

    const expiresInMinutes = dto.expiresInMinutes ?? 30;
    const now = new Date();
    const session = await this.prisma.attemptSession.create({
      data: {
        userId,
        topicId,
        status: AttemptSessionStatus.IN_PROGRESS,
        answers: {},
        startedAt: now,
        lastSeenAt: now,
        expiresAt: new Date(now.getTime() + expiresInMinutes * 60_000),
      },
    });

    return this.mapSession(session);
  }

  async resumeTopicSession(topicId: string, req: ExpressRequest) {
    const userId = this.extractUserId(req);
    await this.ensureTopicExists(topicId);

    const session = await this.prisma.attemptSession.findFirst({
      where: {
        userId,
        topicId,
        status: AttemptSessionStatus.IN_PROGRESS,
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    if (!session) {
      return null;
    }

    const expired = await this.expireSessionIfNeeded(session.id, session.expiresAt);
    if (expired) {
      return null;
    }

    return this.mapSession(session);
  }

  async saveSessionProgress(
    sessionId: string,
    dto: SaveSessionDto,
    req: ExpressRequest,
  ) {
    const userId = this.extractUserId(req);

    const session = await this.prisma.attemptSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new NotFoundException(`Session with id '${sessionId}' was not found`);
    }

    if (session.userId !== userId) {
      throw new ForbiddenException('You do not have access to this session');
    }

    if (session.status !== AttemptSessionStatus.IN_PROGRESS) {
      throw new BadRequestException('Session is not in progress');
    }

    const expired = await this.expireSessionIfNeeded(session.id, session.expiresAt);
    if (expired) {
      throw new BadRequestException('Session has expired. Please start a new session.');
    }

    if (dto.currentQuizId) {
      await this.ensureQuizInTopic(dto.currentQuizId, session.topicId);
    }

    if (dto.selectedAnswer && !dto.currentQuizId) {
      throw new BadRequestException('currentQuizId is required when selectedAnswer is provided');
    }

    const previousAnswers = this.parseAnswers(session.answers);
    const nextAnswersFromSelection =
      dto.currentQuizId && dto.selectedAnswer
        ? { [dto.currentQuizId]: dto.selectedAnswer }
        : {};

    const mergedAnswers = {
      ...previousAnswers,
      ...nextAnswersFromSelection,
      ...(dto.answers ?? {}),
    };

    const now = new Date();
    const updated = await this.prisma.attemptSession.update({
      where: { id: sessionId },
      data: {
        currentQuizId: dto.currentQuizId ?? session.currentQuizId,
        answers: mergedAnswers,
        lastSeenAt: now,
        expiresAt: new Date(now.getTime() + 30 * 60_000),
      },
    });

    return this.mapSession(updated);
  }

  async submitSession(sessionId: string, req: ExpressRequest) {
    const userId = this.extractUserId(req);

    const session = await this.prisma.attemptSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new NotFoundException(`Session with id '${sessionId}' was not found`);
    }

    if (session.userId !== userId) {
      throw new ForbiddenException('You do not have access to this session');
    }

    if (session.status !== AttemptSessionStatus.IN_PROGRESS) {
      throw new BadRequestException('Session is not in progress');
    }

    const expired = await this.expireSessionIfNeeded(session.id, session.expiresAt);
    if (expired) {
      throw new BadRequestException('Session has expired. Please start a new session.');
    }

    const answers = this.parseAnswers(session.answers);
    const quizzes = await this.prisma.quiz.findMany({
      where: {
        topicId: session.topicId,
      },
      include: {
        options: true,
      },
    });

    const attemptPayloads = quizzes
      .map((quiz) => {
        const selectedAnswer = answers[quiz.id];
        if (!selectedAnswer) {
          return null;
        }

        const answerExists = quiz.options.some((option) => option.label === selectedAnswer);
        if (!answerExists) {
          return null;
        }

        const isCorrect = selectedAnswer === quiz.answer;
        return {
          userId,
          quizId: quiz.id,
          topicId: session.topicId,
          selectedAnswer,
          isCorrect,
          score: isCorrect ? 1 : 0,
          startedAt: session.startedAt,
          submittedAt: new Date(),
          durationMs: Math.max(0, new Date().getTime() - session.startedAt.getTime()),
        };
      })
      .filter((item): item is {
        userId: string;
        quizId: string;
        topicId: string;
        selectedAnswer: string;
        isCorrect: boolean;
        score: number;
        startedAt: Date;
        submittedAt: Date;
        durationMs: number;
      } => item !== null);

    if (attemptPayloads.length === 0) {
      throw new BadRequestException('No valid answers found in session');
    }

    const submittedAt = new Date();
    const correctCount = attemptPayloads.filter((item) => item.isCorrect).length;

    await this.prisma.$transaction(async (tx) => {
      await tx.quizAttempt.createMany({
        data: attemptPayloads.map((payload) => ({
          ...payload,
          submittedAt,
          durationMs: Math.max(0, submittedAt.getTime() - session.startedAt.getTime()),
        })),
      });

      await this.updateTopicProgress(
        tx,
        userId,
        session.topicId,
        attemptPayloads.length,
        correctCount,
        submittedAt,
      );

      await tx.attemptSession.update({
        where: { id: session.id },
        data: {
          status: AttemptSessionStatus.SUBMITTED,
          submittedAt,
          lastSeenAt: submittedAt,
        },
      });
    });

    return {
      sessionId: session.id,
      topicId: session.topicId,
      attemptedQuizCount: attemptPayloads.length,
      correctCount,
      score: attemptPayloads.length > 0 ? correctCount / attemptPayloads.length : 0,
      submittedAt,
    };
  }

  async submitAttempt(
    quizId: string,
    dto: SubmitAttemptDto,
    req: ExpressRequest,
  ) {
    const userId = this.extractUserId(req);

    const quiz = await this.prisma.quiz.findUnique({
      where: { id: quizId },
      include: {
        options: true,
      },
    });

    if (!quiz) {
      throw new NotFoundException(`Quiz with id '${quizId}' was not found`);
    }

    const answerExists = quiz.options.some(
      (option) => option.label === dto.selectedAnswer,
    );

    if (!answerExists) {
      throw new BadRequestException('selectedAnswer is invalid for this quiz');
    }

    const startedAt = dto.startedAt ? new Date(dto.startedAt) : null;
    const submittedAt = new Date();
    const durationMs =
      startedAt && !Number.isNaN(startedAt.getTime())
        ? Math.max(0, submittedAt.getTime() - startedAt.getTime())
        : null;

    const isCorrect = dto.selectedAnswer === quiz.answer;
    const score = isCorrect ? 1 : 0;

    const result = await this.prisma.$transaction(async (tx) => {
      const attempt = await tx.quizAttempt.create({
        data: {
          userId,
          quizId: quiz.id,
          topicId: quiz.topicId,
          selectedAnswer: dto.selectedAnswer,
          isCorrect,
          score,
          startedAt,
          submittedAt,
          durationMs,
        },
      });

      await this.updateTopicProgress(tx, userId, quiz.topicId, 1, score, submittedAt);

      return attempt;
    });

    return {
      attemptId: result.id,
      quiz: {
        id: quiz.id,
        quizCode: quiz.quizCode,
      },
      selectedAnswer: dto.selectedAnswer,
      correctAnswer: quiz.answer,
      isCorrect,
      score,
      explanation: quiz.explanation ?? '',
      submittedAt: result.submittedAt,
      durationMs: result.durationMs,
    };
  }

  async getMyAttempts(query: AttemptQueryDto, req: ExpressRequest) {
    const userId = this.extractUserId(req);
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const skip = (page - 1) * limit;

    const where = {
      userId,
      ...(query.topicId ? { topicId: query.topicId } : {}),
      ...(query.quizId ? { quizId: query.quizId } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.quizAttempt.findMany({
        where,
        skip,
        take: limit,
        orderBy: {
          submittedAt: 'desc',
        },
        include: {
          quiz: {
            select: {
              id: true,
              quizCode: true,
              question: true,
            },
          },
          topic: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
        },
      }),
      this.prisma.quizAttempt.count({ where }),
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

  async getMyAttemptById(attemptId: string, req: ExpressRequest) {
    const userId = this.extractUserId(req);

    const attempt = await this.prisma.quizAttempt.findUnique({
      where: { id: attemptId },
      include: {
        quiz: {
          select: {
            id: true,
            quizCode: true,
            question: true,
            answer: true,
            explanation: true,
            options: true,
          },
        },
        topic: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });

    if (!attempt) {
      throw new NotFoundException(`Attempt with id '${attemptId}' was not found`);
    }

    if (attempt.userId !== userId) {
      throw new ForbiddenException('You do not have access to this attempt');
    }

    return attempt;
  }

  async getMyProgress(req: ExpressRequest) {
    const userId = this.extractUserId(req);

    const [attemptSummary, topicProgress] = await this.prisma.$transaction([
      this.prisma.quizAttempt.aggregate({
        where: { userId },
        _count: {
          _all: true,
        },
        _sum: {
          score: true,
        },
      }),
      this.prisma.topicProgress.findMany({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        include: {
          topic: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
        },
      }),
    ]);

    const totalAttempts = attemptSummary._count._all;
    const correctAttempts = attemptSummary._sum.score ?? 0;

    return {
      totalAttempts,
      correctAttempts,
      accuracy: totalAttempts > 0 ? correctAttempts / totalAttempts : 0,
      byTopic: topicProgress,
    };
  }

  async getMyTopicProgress(topicId: string, req: ExpressRequest) {
    const userId = this.extractUserId(req);

    const [topic, progress, quizzesInTopic, attemptsInTopic, recentAttempts] =
      await this.prisma.$transaction([
      this.prisma.topic.findUnique({
        where: { id: topicId },
        select: {
          id: true,
          name: true,
          slug: true,
        },
      }),
      this.prisma.topicProgress.findUnique({
        where: {
          userId_topicId: {
            userId,
            topicId,
          },
        },
      }),
      this.prisma.quiz.findMany({
        where: {
          topicId,
        },
        select: {
          id: true,
          quizCode: true,
          question: true,
          answer: true,
        },
        orderBy: {
          createdAt: 'asc',
        },
      }),
      this.prisma.quizAttempt.findMany({
        where: {
          userId,
          topicId,
        },
        select: {
          id: true,
          quizId: true,
          selectedAnswer: true,
          isCorrect: true,
          submittedAt: true,
        },
        orderBy: {
          submittedAt: 'desc',
        },
      }),
      this.prisma.quizAttempt.findMany({
        where: {
          userId,
          topicId,
        },
        orderBy: {
          submittedAt: 'desc',
        },
        take: 10,
        include: {
          quiz: {
            select: {
              id: true,
              quizCode: true,
              question: true,
            },
          },
        },
      }),
    ]);

    if (!topic) {
      throw new NotFoundException(`Topic with id '${topicId}' was not found`);
    }

    const latestAttemptByQuiz = new Map(
      attemptsInTopic.map((attempt) => [attempt.quizId, attempt]),
    );

    const quizStats = quizzesInTopic.map((quiz) => {
      const attempt = latestAttemptByQuiz.get(quiz.id);

      return {
        quizId: quiz.id,
        quizCode: quiz.quizCode,
        question: quiz.question,
        answered: Boolean(attempt),
        selectedAnswer: attempt?.selectedAnswer ?? null,
        correctAnswer: quiz.answer,
        isCorrect: attempt?.isCorrect ?? null,
        lastSubmittedAt: attempt?.submittedAt ?? null,
      };
    });

    const totalQuizCount = quizzesInTopic.length;
    const attemptedQuizCount = quizStats.filter((quiz) => quiz.answered).length;
    const correctQuizCount = quizStats.filter((quiz) => quiz.isCorrect === true).length;
    const wrongQuizCount = quizStats.filter((quiz) => quiz.isCorrect === false).length;
    const unansweredQuizCount = totalQuizCount - attemptedQuizCount;

    return {
      topic,
      summary: {
        totalQuizCount,
        attemptedQuizCount,
        unansweredQuizCount,
        correctQuizCount,
        wrongQuizCount,
        completionRate:
          totalQuizCount > 0 ? attemptedQuizCount / totalQuizCount : 0,
        accuracyByQuiz:
          attemptedQuizCount > 0 ? correctQuizCount / attemptedQuizCount : 0,
      },
      progress: progress ?? {
        userId,
        topicId,
        totalAttempts: 0,
        correctAttempts: 0,
        accuracy: 0,
        lastAttemptAt: null,
      },
      quizStats,
      recentAttempts,
    };
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
      (value): value is string => typeof value === 'string' && value.trim().length > 0,
    );

    if (!userId) {
      throw new ForbiddenException('Unable to resolve authenticated user id');
    }

    return userId;
  }

  private async ensureTopicExists(topicId: string): Promise<void> {
    const topic = await this.prisma.topic.findUnique({
      where: { id: topicId },
      select: { id: true },
    });

    if (!topic) {
      throw new NotFoundException(`Topic with id '${topicId}' was not found`);
    }
  }

  private async ensureQuizInTopic(quizId: string, topicId: string): Promise<void> {
    const quiz = await this.prisma.quiz.findFirst({
      where: {
        id: quizId,
        topicId,
      },
      select: { id: true },
    });

    if (!quiz) {
      throw new BadRequestException(`Quiz '${quizId}' does not belong to topic '${topicId}'`);
    }
  }

  private async expireSessionIfNeeded(sessionId: string, expiresAt: Date): Promise<boolean> {
    if (expiresAt.getTime() > Date.now()) {
      return false;
    }

    await this.prisma.attemptSession.update({
      where: { id: sessionId },
      data: {
        status: AttemptSessionStatus.EXPIRED,
        lastSeenAt: new Date(),
      },
    });

    return true;
  }

  private parseAnswers(answers: Prisma.JsonValue): Record<string, string> {
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
      return {};
    }

    const entries = Object.entries(answers as Record<string, unknown>).filter(
      ([, value]) => typeof value === 'string',
    );

    return Object.fromEntries(entries) as Record<string, string>;
  }

  private mapSession(session: {
    id: string;
    topicId: string;
    currentQuizId: string | null;
    status: AttemptSessionStatus;
    answers: Prisma.JsonValue;
    startedAt: Date;
    lastSeenAt: Date;
    expiresAt: Date;
    submittedAt: Date | null;
  }) {
    return {
      id: session.id,
      topicId: session.topicId,
      currentQuizId: session.currentQuizId,
      status: session.status,
      answers: this.parseAnswers(session.answers),
      startedAt: session.startedAt,
      lastSeenAt: session.lastSeenAt,
      expiresAt: session.expiresAt,
      submittedAt: session.submittedAt,
    };
  }

  private async updateTopicProgress(
    tx: Prisma.TransactionClient,
    userId: string,
    topicId: string,
    attemptsToAdd: number,
    correctToAdd: number,
    lastAttemptAt: Date,
  ): Promise<void> {
    const existingProgress = await tx.topicProgress.findUnique({
      where: {
        userId_topicId: {
          userId,
          topicId,
        },
      },
    });

    if (!existingProgress) {
      const totalAttempts = attemptsToAdd;
      const correctAttempts = correctToAdd;

      await tx.topicProgress.create({
        data: {
          userId,
          topicId,
          totalAttempts,
          correctAttempts,
          accuracy: totalAttempts > 0 ? correctAttempts / totalAttempts : 0,
          lastAttemptAt,
        },
      });

      return;
    }

    const totalAttempts = existingProgress.totalAttempts + attemptsToAdd;
    const correctAttempts = existingProgress.correctAttempts + correctToAdd;

    await tx.topicProgress.update({
      where: {
        userId_topicId: {
          userId,
          topicId,
        },
      },
      data: {
        totalAttempts,
        correctAttempts,
        accuracy: totalAttempts > 0 ? correctAttempts / totalAttempts : 0,
        lastAttemptAt,
      },
    });
  }
}
