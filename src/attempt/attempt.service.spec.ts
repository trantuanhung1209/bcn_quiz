import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AttemptSessionStatus } from '@prisma/client';
import { AttemptService } from './attempt.service';

describe('AttemptService.saveSessionProgress expiry', () => {
  const prisma = {
    attemptSession: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    quiz: { findFirst: jest.fn() },
  };

  const courseProgressService = {
    evaluateCoursesByTopic: jest.fn(),
  };

  let service: AttemptService;

  const req = { user: { id: 'user-1' } } as never;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AttemptService(
      prisma as never,
      courseProgressService as never,
    );
  });

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
      service.saveSessionProgress(
        'sess-1',
        { answers: { q1: 'A' } },
        req,
      ),
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
      service.saveSessionProgress(
        'sess-2',
        { answers: { q1: 'A' } },
        req,
      ),
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

  it('rejects unknown session', async () => {
    prisma.attemptSession.findUnique.mockResolvedValue(null);

    await expect(
      service.saveSessionProgress('missing', { answers: {} }, req),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
