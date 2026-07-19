import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { AttemptSessionStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SubmitAttemptDto } from './dto/submit-attempt.dto';
import { AttemptQueryDto } from './dto/attempt-query.dto';
import { SessionHistoryQueryDto } from './dto/session-history-query.dto';
import { StartSessionDto } from './dto/start-session.dto';
import { SaveSessionDto } from './dto/save-session.dto';
import { CourseProgressService } from '../course/course-progress.service';

@Injectable()
export class AttemptService {
  private readonly logger = new Logger(AttemptService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly courseProgressService: CourseProgressService,
  ) {}

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
        status: { in: [AttemptSessionStatus.IN_PROGRESS, AttemptSessionStatus.EXPIRED] },
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    if (!session) {
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

    if (
      session.status !== AttemptSessionStatus.IN_PROGRESS &&
      session.status !== AttemptSessionStatus.EXPIRED
    ) {
      throw new BadRequestException('Session is not in progress');
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
        // Re-extend expiry and restore to IN_PROGRESS if it had expired
        status: AttemptSessionStatus.IN_PROGRESS,
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

    if (
      session.status !== AttemptSessionStatus.IN_PROGRESS &&
      session.status !== AttemptSessionStatus.EXPIRED
    ) {
      throw new BadRequestException('Session is not in progress');
    }

    // Allow submit even if session has expired — answers saved before expiry are still valid
    await this.expireSessionIfNeeded(session.id, session.expiresAt);

    const answers = this.parseAnswers(session.answers);
    const quizzes = await this.prisma.quiz.findMany({
      where: {
        topicId: session.topicId,
      },
      orderBy: {
        createdAt: 'asc',
      },
      include: {
        options: true,
      },
    });

    type AttemptPayload = {
      userId: string;
      quizId: string;
      topicId: string;
      selectedAnswer: string;
      isCorrect: boolean;
      score: number;
      startedAt: Date;
      submittedAt: Date;
      durationMs: number;
      // Extra fields for response — not persisted
      quizCode: string;
      question: string;
      code: string | null;
      options: Array<{ label: string; content: string; isCode: boolean }>;
      correctAnswer: string;
      explanation: string;
    };

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
          // Extra fields for response
          quizCode: quiz.quizCode,
          question: quiz.question,
          code: quiz.code ?? null,
          options: quiz.options.map((o) => ({
            label: o.label,
            content: o.content,
            isCode: o.isCode,
          })),
          correctAnswer: quiz.answer,
          explanation: quiz.explanation ?? '',
        };
      })
      .filter((item): item is AttemptPayload => item !== null);

    // Allow submit with zero answers — score will be 0
    const submittedAt = new Date();
    const correctCount = attemptPayloads.filter((item) => item.isCorrect).length;

    await this.prisma.$transaction(async (tx) => {
      if (attemptPayloads.length > 0) {
        await tx.quizAttempt.createMany({
          data: attemptPayloads.map((payload) => ({
            userId: payload.userId,
            quizId: payload.quizId,
            topicId: payload.topicId,
            sessionId: session.id,
            selectedAnswer: payload.selectedAnswer,
            isCorrect: payload.isCorrect,
            score: payload.score,
            startedAt: payload.startedAt,
            submittedAt,
            durationMs: Math.max(0, submittedAt.getTime() - session.startedAt.getTime()),
          })),
        });
      }

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

    await this.safeReevaluateCourseProgressByTopic(userId, session.topicId, req);

    // Build a lookup map from the persisted attempts for quick access
    const attemptByQuizId = new Map(
      attemptPayloads.map((p) => [p.quizId, p]),
    );

    return {
      sessionId: session.id,
      topicId: session.topicId,
      attemptedQuizCount: attemptPayloads.length,
      correctCount,
      score: attemptPayloads.length > 0 ? correctCount / attemptPayloads.length : 0,
      submittedAt,
      quizResults: quizzes.map((quiz) => {
        const attempt = attemptByQuizId.get(quiz.id);
        return {
          quizId: quiz.id,
          quizCode: quiz.quizCode,
          content: {
            text: quiz.question,
            code: quiz.code ?? null,
            has_code: Boolean(quiz.code),
            image: quiz.imageUrl ?? null,
            has_image: Boolean(quiz.imageUrl),
          },
          options: {
            is_code: quiz.options.some((o) => o.isCode),
            data: Object.fromEntries(quiz.options.map((o) => [o.label, o.content])),
          },
          selectedAnswer: attempt?.selectedAnswer ?? null,
          correctAnswer: quiz.answer,
          isCorrect: attempt ? attempt.isCorrect : null,
          explanation: quiz.explanation ?? '',
        };
      }),
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

    await this.safeReevaluateCourseProgressByTopic(userId, quiz.topicId, req);

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

    const [items, total] = await Promise.all([
      this.prisma.quizAttempt.findMany({
        where,
        skip,
        take: limit,
        orderBy: {
          submittedAt: 'desc',
        },
        select: {
          id: true,
          userId: true,
          quizId: true,
          topicId: true,
          sessionId: true,
          selectedAnswer: true,
          isCorrect: true,
          score: true,
          startedAt: true,
          submittedAt: true,
          durationMs: true,
          createdAt: true,
          quiz: {
            select: {
              id: true,
              quizCode: true,
              question: true,
              imageUrl: true,
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
            imageUrl: true,
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

  async getMySessions(query: SessionHistoryQueryDto, req: ExpressRequest) {
    const userId = this.extractUserId(req);
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const skip = (page - 1) * limit;

    const where = {
      userId,
      status: AttemptSessionStatus.SUBMITTED,
      ...(query.topicId ? { topicId: query.topicId } : {}),
    };

    const [sessions, total] = await Promise.all([
      this.prisma.attemptSession.findMany({
        where,
        skip,
        take: limit,
        orderBy: {
          submittedAt: 'desc',
        },
        include: {
          topic: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
          attempts: {
            select: {
              id: true,
              quizId: true,
              isCorrect: true,
              selectedAnswer: true,
              score: true,
              durationMs: true,
            },
          },
        },
      }),
      this.prisma.attemptSession.count({ where }),
    ]);

    const legacySessionIds = sessions
      .filter((session) => session.attempts.length === 0)
      .map((session) => session.id);

    const legacySummaries = await this.buildLegacySessionSummaries(
      sessions.filter((session) => legacySessionIds.includes(session.id)),
    );

    const items = sessions.map((session) => {
      if (session.attempts.length > 0) {
        const answeredCount = session.attempts.length;
        const correctCount = session.attempts.filter((a) => a.isCorrect).length;
        return {
          id: session.id,
          topicId: session.topicId,
          topic: session.topic,
          status: session.status,
          startedAt: session.startedAt,
          submittedAt: session.submittedAt,
          durationMs:
            session.submittedAt != null
              ? Math.max(0, session.submittedAt.getTime() - session.startedAt.getTime())
              : session.attempts[0]?.durationMs ?? null,
          answeredCount,
          correctCount,
          score: answeredCount > 0 ? correctCount / answeredCount : 0,
        };
      }

      const legacy = legacySummaries.get(session.id);
      return {
        id: session.id,
        topicId: session.topicId,
        topic: session.topic,
        status: session.status,
        startedAt: session.startedAt,
        submittedAt: session.submittedAt,
        durationMs:
          session.submittedAt != null
            ? Math.max(0, session.submittedAt.getTime() - session.startedAt.getTime())
            : null,
        answeredCount: legacy?.answeredCount ?? 0,
        correctCount: legacy?.correctCount ?? 0,
        score: legacy?.score ?? 0,
      };
    });

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

  async getMySessionById(sessionId: string, req: ExpressRequest) {
    const userId = this.extractUserId(req);

    const session = await this.prisma.attemptSession.findUnique({
      where: { id: sessionId },
      include: {
        topic: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
        attempts: {
          select: {
            id: true,
            quizId: true,
            selectedAnswer: true,
            isCorrect: true,
            score: true,
            durationMs: true,
            submittedAt: true,
          },
        },
      },
    });

    if (!session) {
      throw new NotFoundException(`Session with id '${sessionId}' was not found`);
    }

    if (session.userId !== userId) {
      throw new ForbiddenException('You do not have access to this session');
    }

    if (session.status !== AttemptSessionStatus.SUBMITTED) {
      throw new BadRequestException('Session has not been submitted yet');
    }

    const quizzes = await this.prisma.quiz.findMany({
      where: { topicId: session.topicId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        quizCode: true,
        question: true,
        code: true,
        imageUrl: true,
        answer: true,
        explanation: true,
        options: {
          select: {
            label: true,
            content: true,
            isCode: true,
          },
        },
      },
    });

    const attemptByQuizId = new Map(session.attempts.map((a) => [a.quizId, a]));
    const answers = this.parseAnswers(session.answers);

    // Legacy sessions (submitted before sessionId linking): rebuild from answers JSON
    const useLegacyAnswers = session.attempts.length === 0;

    const quizResults = quizzes.map((quiz) => {
      const linkedAttempt = attemptByQuizId.get(quiz.id);
      const selectedAnswer = useLegacyAnswers
        ? answers[quiz.id] ?? null
        : linkedAttempt?.selectedAnswer ?? null;

      let isCorrect: boolean | null = null;
      if (linkedAttempt) {
        isCorrect = linkedAttempt.isCorrect;
      } else if (useLegacyAnswers && selectedAnswer) {
        const answerExists = quiz.options.some((option) => option.label === selectedAnswer);
        isCorrect = answerExists ? selectedAnswer === quiz.answer : null;
      }

      return {
        quizId: quiz.id,
        quizCode: quiz.quizCode,
        attemptId: linkedAttempt?.id ?? null,
        content: {
          text: quiz.question,
          code: quiz.code ?? null,
          has_code: Boolean(quiz.code),
          image: quiz.imageUrl ?? null,
          has_image: Boolean(quiz.imageUrl),
        },
        options: {
          is_code: quiz.options.some((o) => o.isCode),
          data: Object.fromEntries(quiz.options.map((o) => [o.label, o.content])),
        },
        selectedAnswer,
        correctAnswer: quiz.answer,
        isCorrect,
        explanation: quiz.explanation ?? '',
      };
    });

    const answeredResults = quizResults.filter((item) => item.selectedAnswer != null);
    const correctCount = answeredResults.filter((item) => item.isCorrect === true).length;
    const answeredCount = answeredResults.length;

    return {
      id: session.id,
      topicId: session.topicId,
      topic: session.topic,
      status: session.status,
      startedAt: session.startedAt,
      submittedAt: session.submittedAt,
      durationMs:
        session.submittedAt != null
          ? Math.max(0, session.submittedAt.getTime() - session.startedAt.getTime())
          : null,
      answeredCount,
      correctCount,
      score: answeredCount > 0 ? correctCount / answeredCount : 0,
      quizResults,
    };
  }

  async getMyProgress(req: ExpressRequest) {
    const userId = this.extractUserId(req);

    const [attemptSummary, topicProgress] = await Promise.all([
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
      await Promise.all([
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
          imageUrl: true,
          answer: true,
        },
        orderBy: {
          createdAt: 'asc',
        },
      }),
      // Latest attempt per quiz only — avoid loading unbounded attempt history.
      this.prisma.quizAttempt.findMany({
        where: {
          userId,
          topicId,
        },
        distinct: ['quizId'],
        select: {
          id: true,
          quizId: true,
          selectedAnswer: true,
          isCorrect: true,
          submittedAt: true,
        },
        orderBy: [{ quizId: 'asc' }, { submittedAt: 'desc' }],
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
              imageUrl: true,
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
        image: quiz.imageUrl ?? null,
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

  private async buildLegacySessionSummaries(
    sessions: Array<{
      id: string;
      topicId: string;
      answers: Prisma.JsonValue;
    }>,
  ): Promise<Map<string, { answeredCount: number; correctCount: number; score: number }>> {
    const result = new Map<
      string,
      { answeredCount: number; correctCount: number; score: number }
    >();

    if (sessions.length === 0) {
      return result;
    }

    const topicIds = [...new Set(sessions.map((session) => session.topicId))];
    const quizzes = await this.prisma.quiz.findMany({
      where: { topicId: { in: topicIds } },
      select: {
        id: true,
        topicId: true,
        answer: true,
        options: {
          select: { label: true },
        },
      },
    });

    const quizzesByTopic = new Map<string, typeof quizzes>();
    for (const quiz of quizzes) {
      const list = quizzesByTopic.get(quiz.topicId) ?? [];
      list.push(quiz);
      quizzesByTopic.set(quiz.topicId, list);
    }

    for (const session of sessions) {
      const answers = this.parseAnswers(session.answers);
      const topicQuizzes = quizzesByTopic.get(session.topicId) ?? [];
      let answeredCount = 0;
      let correctCount = 0;

      for (const quiz of topicQuizzes) {
        const selectedAnswer = answers[quiz.id];
        if (!selectedAnswer) {
          continue;
        }

        const answerExists = quiz.options.some((option) => option.label === selectedAnswer);
        if (!answerExists) {
          continue;
        }

        answeredCount += 1;
        if (selectedAnswer === quiz.answer) {
          correctCount += 1;
        }
      }

      result.set(session.id, {
        answeredCount,
        correctCount,
        score: answeredCount > 0 ? correctCount / answeredCount : 0,
      });
    }

    return result;
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
          isCompleted:
            totalAttempts > 0 && correctAttempts / totalAttempts >= 0.8,
          completedAt:
            totalAttempts > 0 && correctAttempts / totalAttempts >= 0.8
              ? lastAttemptAt
              : null,
          completionThreshold: 0.8,
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
        isCompleted:
          existingProgress.isCompleted ||
          (totalAttempts > 0 && correctAttempts / totalAttempts >= 0.8),
        completedAt:
          existingProgress.isCompleted ||
          !(totalAttempts > 0 && correctAttempts / totalAttempts >= 0.8)
            ? existingProgress.completedAt
            : lastAttemptAt,
        completionThreshold: 0.8,
        lastAttemptAt,
      },
    });
  }

  private async safeReevaluateCourseProgressByTopic(
    userId: string,
    topicId: string,
    req: ExpressRequest,
  ): Promise<void> {
    try {
      await this.courseProgressService.evaluateCoursesByTopic(userId, topicId, req);
    } catch (error) {
      this.logger.warn(
        `[safeReevaluateCourseProgressByTopic] failed userId=${userId} topicId=${topicId}`,
      );
    }
  }
}
