import { Injectable, Logger } from '@nestjs/common';
import { CourseProgressStatus, ProjectSubmissionStatus } from '@prisma/client';
import type { Request as ExpressRequest } from 'express';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ProfilesService } from '../profiles/profiles.service';

@Injectable()
export class CourseProgressService {
  private readonly logger = new Logger(CourseProgressService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly profilesService: ProfilesService,
  ) {}

  async evaluateCoursesByTopic(
    userId: string,
    topicId: string,
    req?: ExpressRequest,
  ): Promise<void> {
    const links = await this.prisma.courseTopic.findMany({
      where: { topicId },
      select: { courseId: true },
    });

    const courseIds = [...new Set(links.map((item) => item.courseId))];

    for (const courseId of courseIds) {
      await this.evaluateCourseProgress(userId, courseId, req);
    }
  }

  /**
   * Option B: when course curriculum changes (topics / hasProject),
   * recompute progress for every learner who already has a progress row.
   * COMPLETED users may be demoted; certificates are kept (not deleted).
   */
  async reevaluateAllUsersForCourse(courseId: string): Promise<number> {
    const rows = await this.prisma.userCourseProgress.findMany({
      where: { courseId },
      select: { userId: true },
    });

    const userIds = rows.map((row) => row.userId);
    const concurrency = 10;

    for (let i = 0; i < userIds.length; i += concurrency) {
      const batch = userIds.slice(i, i + concurrency);
      await Promise.all(
        batch.map((userId) => this.evaluateCourseProgress(userId, courseId)),
      );
    }

    this.logger.log(
      `[reevaluateAllUsersForCourse] courseId=${courseId} users=${userIds.length}`,
    );

    return userIds.length;
  }

  /**
   * Option B: new quizzes invalidate sticky topic completion, then reopen
   * linked course progress for affected learners.
   */
  async reopenTopicProgressAndCourses(topicId: string): Promise<number> {
    const cleared = await this.prisma.topicProgress.updateMany({
      where: {
        topicId,
        isCompleted: true,
      },
      data: {
        isCompleted: false,
        completedAt: null,
      },
    });

    const links = await this.prisma.courseTopic.findMany({
      where: { topicId },
      select: { courseId: true },
    });

    const courseIds = [...new Set(links.map((item) => item.courseId))];
    let totalUsers = 0;

    for (const courseId of courseIds) {
      totalUsers += await this.reevaluateAllUsersForCourse(courseId);
    }

    this.logger.log(
      `[reopenTopicProgressAndCourses] topicId=${topicId} clearedTopicProgress=${cleared.count} courses=${courseIds.length} userEvals=${totalUsers}`,
    );

    return totalUsers;
  }

  async evaluateCourseProgress(
    userId: string,
    courseId: string,
    req?: ExpressRequest,
  ): Promise<void> {
    const [course, existing] = await Promise.all([
      this.prisma.course.findUnique({
        where: { id: courseId },
        include: {
          topics: {
            select: {
              topicId: true,
            },
          },
          projectRequirement: {
            select: {
              id: true,
              isRequired: true,
            },
          },
        },
      }),
      this.prisma.userCourseProgress.findUnique({
        where: {
          userId_courseId: {
            userId,
            courseId,
          },
        },
      }),
    ]);

    if (!course) {
      return;
    }

    const topicIds = course.topics.map((item) => item.topicId);
    const totalTopics = topicIds.length;

    const topicProgresses = totalTopics
      ? await this.prisma.topicProgress.findMany({
          where: {
            userId,
            topicId: {
              in: topicIds,
            },
          },
          select: {
            topicId: true,
            isCompleted: true,
            accuracy: true,
          },
        })
      : [];

    // Use sticky isCompleted only. Accuracy is NOT enough after curriculum reopen
    // (new quizzes clear isCompleted while historical accuracy may still be high).
    const completedTopicCount = topicProgresses.filter(
      (item) => item.isCompleted,
    ).length;

    const topicMilestoneCompleted =
      totalTopics > 0 && completedTopicCount === totalTopics;

    const requiresProjectApproval = course.hasProject;
    const hasProjectRequirement =
      requiresProjectApproval && Boolean(course.projectRequirement?.isRequired);

    const approvedProject = requiresProjectApproval
      ? await this.prisma.projectSubmission.findFirst({
          where: {
            userId,
            courseId,
            status: ProjectSubmissionStatus.APPROVED,
          },
          orderBy: {
            reviewedAt: 'desc',
          },
          select: {
            id: true,
            reviewedAt: true,
          },
        })
      : null;

    const topicWeight = requiresProjectApproval ? 50 : 100;
    const topicProgressPercent =
      totalTopics > 0
        ? Math.round((completedTopicCount / totalTopics) * topicWeight)
        : 0;
    const projectProgressPercent = approvedProject ? 50 : 0;

    let progressPercent = Math.min(
      100,
      topicProgressPercent + projectProgressPercent,
    );

    let status: CourseProgressStatus = CourseProgressStatus.IN_PROGRESS;

    if (
      topicMilestoneCompleted &&
      requiresProjectApproval &&
      !approvedProject
    ) {
      status = CourseProgressStatus.PROJECT_PENDING_APPROVAL;
      progressPercent = 50;
    }

    if (topicMilestoneCompleted && !requiresProjectApproval) {
      status = CourseProgressStatus.COMPLETED;
      progressPercent = 100;
    }

    if (topicMilestoneCompleted && requiresProjectApproval && approvedProject) {
      status = CourseProgressStatus.COMPLETED;
      progressPercent = 100;
    }

    const now = new Date();

    const progress = await this.prisma.userCourseProgress.upsert({
      where: {
        userId_courseId: {
          userId,
          courseId,
        },
      },
      update: {
        topicProgressPercent,
        projectProgressPercent,
        progressPercent,
        status,
        topicsCompletedAt: topicMilestoneCompleted
          ? (existing?.topicsCompletedAt ?? now)
          : null,
        projectApprovedAt:
          status === CourseProgressStatus.COMPLETED && approvedProject
            ? (approvedProject.reviewedAt ?? now)
            : (existing?.projectApprovedAt ?? null),
        completedAt:
          status === CourseProgressStatus.COMPLETED
            ? (existing?.completedAt ?? now)
            : null,
      },
      create: {
        userId,
        courseId,
        topicProgressPercent,
        projectProgressPercent,
        progressPercent,
        status,
        topicsCompletedAt: topicMilestoneCompleted ? now : null,
        projectApprovedAt: approvedProject
          ? (approvedProject.reviewedAt ?? now)
          : null,
        completedAt: status === CourseProgressStatus.COMPLETED ? now : null,
      },
    });

    if (
      existing?.status === CourseProgressStatus.COMPLETED &&
      status !== CourseProgressStatus.COMPLETED
    ) {
      this.logger.log(
        `[evaluateCourseProgress] reopen demote userId=${userId} courseId=${courseId} ${existing.status} -> ${status} progress=${progressPercent}`,
      );
    }

    if (
      status === CourseProgressStatus.COMPLETED &&
      existing?.status !== CourseProgressStatus.COMPLETED
    ) {
      const existingCertificate = await this.prisma.certificate.findUnique({
        where: {
          userId_courseId: {
            userId,
            courseId,
          },
        },
        select: { id: true },
      });

      await this.prisma.certificate.upsert({
        where: {
          userId_courseId: {
            userId,
            courseId,
          },
        },
        update: {
          issuedAt: now,
          metadata: {
            topicProgressPercent,
            projectProgressPercent,
            refreshed: true,
          },
        },
        create: {
          userId,
          courseId,
          certificateCode: `CRT-${randomUUID()}`,
          issuedAt: now,
          metadata: {
            topicProgressPercent,
            projectProgressPercent,
          },
        },
      });

      // Timeline only on first completion — re-complete after reopen refreshes cert only.
      if (!existingCertificate && req && this.extractUserId(req) === userId) {
        await this.profilesService.createTimelineEvent(req, {
          eventType: 'COURSE_COMPLETE',
          title: `Hoàn thành khóa học ${course.name}`,
          metadata: {
            courseId: courseId,
            courseSlug: course.slug,
            score: progress.progressPercent,
          },
        });
      }
    }

    if (req && this.extractUserId(req) === userId) {
      const certificates = await this.prisma.certificate.findMany({
        where: { userId },
        orderBy: { issuedAt: 'desc' },
        include: {
          course: {
            select: {
              id: true,
              slug: true,
              name: true,
            },
          },
        },
      });

      await this.profilesService.patchMyMetadata(req, {
        courseProgress: {
          courseId,
          progressPercent: progress.progressPercent,
          topicProgressPercent: progress.topicProgressPercent,
          projectProgressPercent: progress.projectProgressPercent,
          status: progress.status,
          updatedAt: progress.updatedAt,
        },
        certificates: certificates.map((item) => ({
          id: item.id,
          courseId: item.courseId,
          courseSlug: item.course.slug,
          courseName: item.course.name,
          certificateCode: item.certificateCode,
          issuedAt: item.issuedAt,
        })),
      });
    }

    this.logger.log(
      `[evaluateCourseProgress] userId=${userId} courseId=${courseId} status=${status} progress=${progressPercent}`,
    );
  }

  private extractUserId(req: ExpressRequest): string | null {
    const user = (req as ExpressRequest & { user?: any }).user;

    const candidates = [
      user?.id,
      user?.sub,
      user?.user?.id,
      user?.data?.id,
      user?.data?.user?.id,
    ];

    return (
      candidates.find(
        (value): value is string =>
          typeof value === 'string' && value.trim().length > 0,
      ) ?? null
    );
  }
}
