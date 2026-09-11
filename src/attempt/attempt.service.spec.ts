import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AttemptSessionStatus } from '@prisma/client';
import { AttemptService } from './attempt.service';

describe('AttemptService', () => {
  const prisma = {
    attemptSession: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    topic: { findUnique: jest.fn() },
    topicProgress: { findUnique: jest.fn() },
    quiz: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    quizAttempt: { findMany: jest.fn() },
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
  };

  const courseProgressService = {
    evaluateCoursesByTopic: jest.fn(),
    syncUserTopicCoverage: jest.fn(),
  };

  let service: AttemptService;

  const req = { user: { id: 'user-1' } } as never;

  const openTopic = {
    id: 'topic-1',
    startsAt: null as Date | null,
    endsAt: null as Date | null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AttemptService(
      prisma as never,
      courseProgressService as never,
    );
    prisma.topic.findUnique.mockResolvedValue(openTopic);
  });

  describe('saveSessionProgress expiry', () => {
    it('rejects save when session status is already EXPIRED', async () => {
      prisma.attemptSession.findUnique.mockResolvedValue({
        id: 'sess-1',
        userId: 'user-1',
        topicId: 'topic-1',
        status: AttemptSessionStatus.EXPIRED,
        expiresAt: new Date(Date.now() - 60_000),
        answers: {},
        currentQuizId: null,
      });

      await expect(
        service.saveSessionProgress('sess-1', { answers: { q1: 'A' } }, req),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.attemptSession.update).not.toHaveBeenCalled();
    });

    it('marks overdue IN_PROGRESS session expired and rejects save', async () => {
      prisma.attemptSession.findUnique.mockResolvedValue({
        id: 'sess-2',
        userId: 'user-1',
        topicId: 'topic-1',
        status: AttemptSessionStatus.IN_PROGRESS,
        expiresAt: new Date(Date.now() - 1_000),
        answers: {},
        currentQuizId: null,
      });
      prisma.attemptSession.update.mockResolvedValue({});

      await expect(
        service.saveSessionProgress('sess-2', { answers: { q1: 'A' } }, req),
      ).rejects.toEqual(
        expect.objectContaining({
          message: 'Session has expired',
        }),
      );

      expect(prisma.attemptSession.update).toHaveBeenCalledWith({
        where: { id: 'sess-2' },
        data: expect.objectContaining({
          status: AttemptSessionStatus.EXPIRED,
        }),
      });
    });

    it('rejects save for another user', async () => {
      prisma.attemptSession.findUnique.mockResolvedValue({
        id: 'sess-3',
        userId: 'other-user',
        topicId: 'topic-1',
        status: AttemptSessionStatus.IN_PROGRESS,
        expiresAt: new Date(Date.now() + 60_000),
        answers: {},
        currentQuizId: null,
      });

      await expect(
        service.saveSessionProgress('sess-3', { answers: {} }, req),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('topic schedule window', () => {
    const endsAt = new Date(Date.now() + 10 * 60_000);
    const startsAtFuture = new Date(Date.now() + 60 * 60_000);
    const endsAtPast = new Date(Date.now() - 60_000);

    it('rejects start before startsAt', async () => {
      prisma.topic.findUnique.mockResolvedValue({
        id: 'topic-1',
        startsAt: startsAtFuture,
        endsAt: new Date(Date.now() + 2 * 60 * 60_000),
      });

      await expect(
        service.startTopicSession('topic-1', { expiresInMinutes: 30 }, req),
      ).rejects.toEqual(
        expect.objectContaining({
          response: expect.objectContaining({ code: 'TOPIC_NOT_OPEN_YET' }),
        }),
      );
      expect(prisma.attemptSession.create).not.toHaveBeenCalled();
    });

    it('rejects start after endsAt', async () => {
      prisma.topic.findUnique.mockResolvedValue({
        id: 'topic-1',
        startsAt: new Date(Date.now() - 2 * 60 * 60_000),
        endsAt: endsAtPast,
      });

      await expect(
        service.startTopicSession('topic-1', { expiresInMinutes: 30 }, req),
      ).rejects.toEqual(
        expect.objectContaining({
          response: expect.objectContaining({ code: 'TOPIC_CLOSED' }),
        }),
      );
    });

    it('clamps expiresAt to endsAt on start', async () => {
      prisma.topic.findUnique.mockResolvedValue({
        id: 'topic-1',
        startsAt: null,
        endsAt,
      });
      prisma.attemptSession.findFirst.mockResolvedValue(null);
      const created = {
        id: 'sess-new',
        userId: 'user-1',
        topicId: 'topic-1',
        status: AttemptSessionStatus.IN_PROGRESS,
        answers: {},
        currentQuizId: null,
        startedAt: new Date(),
        lastSeenAt: new Date(),
        expiresAt: endsAt,
        submittedAt: null,
      };
      prisma.attemptSession.create.mockResolvedValue(created);

      const result = await service.startTopicSession(
        'topic-1',
        { expiresInMinutes: 30 },
        req,
      );

      expect(prisma.attemptSession.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          expiresAt: endsAt,
        }),
      });
      expect(result.id).toBe('sess-new');
    });

    it('rejects save after endsAt', async () => {
      prisma.attemptSession.findUnique.mockResolvedValue({
        id: 'sess-4',
        userId: 'user-1',
        topicId: 'topic-1',
        status: AttemptSessionStatus.IN_PROGRESS,
        expiresAt: new Date(Date.now() + 60_000),
        answers: {},
        currentQuizId: null,
      });
      prisma.topic.findUnique.mockResolvedValue({
        id: 'topic-1',
        startsAt: null,
        endsAt: endsAtPast,
      });

      await expect(
        service.saveSessionProgress('sess-4', { answers: { q1: 'A' } }, req),
      ).rejects.toEqual(
        expect.objectContaining({
          response: expect.objectContaining({ code: 'TOPIC_CLOSED' }),
        }),
      );
    });

    it('allows submit after endsAt when session exists', async () => {
      prisma.attemptSession.findUnique.mockResolvedValue({
        id: 'sess-5',
        userId: 'user-1',
        topicId: 'topic-1',
        status: AttemptSessionStatus.IN_PROGRESS,
        expiresAt: new Date(Date.now() + 60_000),
        answers: { q1: 'A' },
        currentQuizId: null,
        startedAt: new Date(Date.now() - 60_000),
        lastSeenAt: new Date(),
      });
      prisma.topic.findUnique.mockResolvedValue({
        id: 'topic-1',
        startsAt: null,
        endsAt: endsAtPast,
      });
      prisma.quiz.findMany.mockResolvedValue([
        {
          id: 'q1',
          quizCode: 'Q1',
          question: 'Q?',
          code: null,
          answer: 'A',
          explanation: '',
          imageUrl: null,
          options: [
            { label: 'A', content: 'yes', isCode: false },
            { label: 'B', content: 'no', isCode: false },
          ],
        },
      ]);
      prisma.$transaction.mockImplementation(
        async (cb: (tx: unknown) => Promise<unknown>) => {
          const tx = {
            quizAttempt: { createMany: jest.fn() },
            attemptSession: { update: jest.fn() },
            topicProgress: {
              findUnique: jest.fn().mockResolvedValue(null),
              create: jest.fn(),
              update: jest.fn(),
              upsert: jest.fn(),
            },
            quiz: { count: jest.fn().mockResolvedValue(2) },
            $queryRaw: jest.fn().mockResolvedValue([{ count: 1 }]),
          };
          return cb(tx);
        },
      );
      courseProgressService.evaluateCoursesByTopic.mockResolvedValue(undefined);

      const result = await service.submitSession('sess-5', req);

      expect(result.sessionId).toBe('sess-5');
      expect(result.correctCount).toBe(1);
      expect(prisma.topic.findUnique).toHaveBeenCalled();
    });
  });

  describe('getMyTopicProgress answer visibility', () => {
    it('hides correctAnswer for unanswered quizzes', async () => {
      prisma.topic.findUnique.mockResolvedValue({
        id: 'topic-1',
        name: 'T1',
        slug: 't1',
      });
      prisma.topicProgress.findUnique.mockResolvedValue(null);
      prisma.quiz.findMany.mockResolvedValue([
        {
          id: 'q1',
          quizCode: 'Q1',
          question: 'One?',
          imageUrl: null,
          answer: '1',
        },
        {
          id: 'q2',
          quizCode: 'Q2',
          question: 'Two?',
          imageUrl: null,
          answer: '2',
        },
      ]);
      prisma.quizAttempt.findMany
        .mockResolvedValueOnce([
          {
            id: 'a1',
            quizId: 'q1',
            selectedAnswer: '1',
            isCorrect: true,
            submittedAt: new Date(),
          },
        ])
        .mockResolvedValueOnce([]);

      const result = await service.getMyTopicProgress('topic-1', req);

      expect(result.quizStats).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            quizId: 'q1',
            answered: true,
            correctAnswer: '1',
          }),
          expect.objectContaining({
            quizId: 'q2',
            answered: false,
            correctAnswer: null,
          }),
        ]),
      );
    });
  });

  describe('resumeTopicSession', () => {
    it('expires overdue in-progress sessions on resume', async () => {
      const expiredAt = new Date(Date.now() - 5_000);
      prisma.attemptSession.findFirst.mockResolvedValue({
        id: 'sess-r',
        userId: 'user-1',
        topicId: 'topic-1',
        status: AttemptSessionStatus.IN_PROGRESS,
        answers: {},
        currentQuizId: null,
        startedAt: new Date(),
        lastSeenAt: new Date(),
        expiresAt: expiredAt,
        submittedAt: null,
      });
      prisma.attemptSession.update.mockResolvedValue({});

      const result = await service.resumeTopicSession('topic-1', req);

      expect(result?.status).toBe(AttemptSessionStatus.EXPIRED);
      expect(prisma.attemptSession.update).toHaveBeenCalled();
    });
  });
});
