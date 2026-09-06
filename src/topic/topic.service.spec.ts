import { ConflictException, NotFoundException } from '@nestjs/common';
import { TopicService } from './topic.service';

describe('TopicService.resolveTopicBySlug', () => {
  const prisma = {
    topic: { findMany: jest.fn() },
    courseTopic: { findFirst: jest.fn() },
  };

  const cloudinaryService = {};
  const courseProgressService = {};

  let service: TopicService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TopicService(
      prisma as never,
      cloudinaryService as never,
      courseProgressService as never,
    );
  });

  it('resolves uniquely when courseId is provided', async () => {
    prisma.courseTopic.findFirst.mockResolvedValue({
      topic: { id: 't1', slug: 'intro', _count: { quizzes: 2 } },
    });

    const topic = await service.getTopicBySlug('intro', 'course-1');

    expect(topic).toEqual({
      id: 't1',
      slug: 'intro',
      _count: { quizzes: 2 },
    });
    expect(prisma.courseTopic.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { courseId: 'course-1', topic: { slug: 'intro' } },
      }),
    );
  });

  it('throws ConflictException when slug exists in multiple courses', async () => {
    prisma.topic.findMany.mockResolvedValue([
      { id: 't1', slug: 'intro' },
      { id: 't2', slug: 'intro' },
    ]);

    await expect(service.getTopicBySlug('intro')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('throws NotFoundException when slug is unknown', async () => {
    prisma.topic.findMany.mockResolvedValue([]);

    await expect(service.getTopicBySlug('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
