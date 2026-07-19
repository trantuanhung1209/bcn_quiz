import { Injectable, Logger } from '@nestjs/common';
import {
  CourseProgressStatus,
  ProjectSubmissionStatus,
  type UserCourseProgress,
} from '@prisma/client';
import type { Request as ExpressRequest } from 'express';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ProfilesService } from '../profiles/profiles.service';

type CourseForProgressEval = {
  id: string;
  name: string;
  slug: string;
  hasProject: boolean;
  topics: Array<{ topicId: string }>;
  projectRequirement: { id: string; isRequired: boolean } | null;
};

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
  ): Promise<UserCourseProgress | null> {
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
      return null;
    }

    const topicIds = course.topics.map((item) => item.topicId);

    // Self-heal on read: quizzes added after topic completion must reopen that topic
    // even if the admin create-path fan-out was missed / not deployed yet.
    await this.healStaleTopicCompletions(userId, topicIds);

    const progress = await this.computeAndUpsertCourseProgress(
      userId,
      course,
      existing,
    );

    await this.maybeIssueCertificateAndSyncProfiles(
      userId,
      course,
      existing,
      progress,
      req,
    );

    this.logger.debug(
      `[evaluateCourseProgress] userId=${userId} courseId=${courseId} status=${progress.status} progress=${progress.progressPercent}`,
    );

    return progress;
  }

  /**
   * Batch heal + recompute for a page of courses.
   * Shared topic-heal / reads — no Profiles HTTP (GET path).
   */
  async evaluateCourseProgressBatch(
    userId: string,
    courseIds: string[],
  ): Promise<void> {
    const uniqueCourseIds = [...new Set(courseIds.filter(Boolean))];
    if (uniqueCourseIds.length === 0) {
      return;
    }

    const [courses, existingRows] = await Promise.all([
      this.prisma.course.findMany({
        where: { id: { in: uniqueCourseIds } },
        include: {
          topics: {
            select: { topicId: true },
          },
          projectRequirement: {
            select: {
              id: true,
              isRequired: true,
            },
          },
        },
      }),
      this.prisma.userCourseProgress.findMany({
        where: {
          userId,
          courseId: { in: uniqueCourseIds },
        },
      }),
    ]);

    const allTopicIds = [
      ...new Set(courses.flatMap((course) => course.topics.map((t) => t.topicId))),
    ];

    await this.healStaleTopicCompletions(userId, allTopicIds);

    const projectCourseIds = courses
      .filter((course) => course.hasProject)
      .map((course) => course.id);

    const [topicProgresses, approvedProjects] = await Promise.all([
      allTopicIds.length
        ? this.prisma.topicProgress.findMany({
            where: {
              userId,
              topicId: { in: allTopicIds },
            },
            select: {
              topicId: true,
              isCompleted: true,
            },
          })
        : Promise.resolve(
            [] as Array<{ topicId: string; isCompleted: boolean }>,
          ),
      projectCourseIds.length
        ? this.prisma.projectSubmission.findMany({
            where: {
              userId,
              courseId: { in: projectCourseIds },
              status: ProjectSubmissionStatus.APPROVED,
            },
            orderBy: {
              reviewedAt: 'desc',
            },
            select: {
              courseId: true,
              reviewedAt: true,
            },
          })
        : Promise.resolve(
            [] as Array<{ courseId: string; reviewedAt: Date | null }>,
          ),
    ]);

    const completedTopicIds = new Set(
      topicProgresses.filter((row) => row.isCompleted).map((row) => row.topicId),
    );

    const approvedByCourseId = new Map<string, Date | null>();
    for (const row of approvedProjects) {
      if (!approvedByCourseId.has(row.courseId)) {
        approvedByCourseId.set(row.courseId, row.reviewedAt);
      }
    }

    const existingByCourseId = new Map(
      existingRows.map((row) => [row.courseId, row]),
    );

    await Promise.all(
      courses.map((course) => {
        const topicIds = course.topics.map((item) => item.topicId);
        const completedTopicCount = topicIds.filter((topicId) =>
          completedTopicIds.has(topicId),
        ).length;
        const approvedReviewedAt = approvedByCourseId.get(course.id);

        return this.upsertComputedCourseProgress(
          userId,
          course,
          existingByCourseId.get(course.id) ?? null,
          {
            totalTopics: topicIds.length,
            completedTopicCount,
            approvedReviewedAt:
              approvedReviewedAt === undefined ? null : approvedReviewedAt,
            hasApprovedProject: approvedByCourseId.has(course.id),
          },
        );
      }),
    );
  }

  private async computeAndUpsertCourseProgress(
    userId: string,
    course: CourseForProgressEval,
    existing: UserCourseProgress | null,
  ): Promise<UserCourseProgress> {
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
          },
        })
      : [];

    const completedTopicCount = topicProgresses.filter(
      (item) => item.isCompleted,
    ).length;

    const requiresProjectApproval = course.hasProject;
    const approvedProject = requiresProjectApproval
      ? await this.prisma.projectSubmission.findFirst({
          where: {
            userId,
            courseId: course.id,
            status: ProjectSubmissionStatus.APPROVED,
          },
          orderBy: {
            reviewedAt: 'desc',
          },
          select: {
            reviewedAt: true,
          },
        })
      : null;

    return this.upsertComputedCourseProgress(userId, course, existing, {
      totalTopics,
      completedTopicCount,
      approvedReviewedAt: approvedProject?.reviewedAt ?? null,
      hasApprovedProject: Boolean(approvedProject),
    });
  }

  private async upsertComputedCourseProgress(
    userId: string,
    course: CourseForProgressEval,
    existing: UserCourseProgress | null,
    stats: {
      totalTopics: number;
      completedTopicCount: number;
      approvedReviewedAt: Date | null;
      hasApprovedProject: boolean;
    },
  ): Promise<UserCourseProgress> {
    const { totalTopics, completedTopicCount, approvedReviewedAt, hasApprovedProject } =
      stats;

    // Use sticky isCompleted only. Accuracy is NOT enough after curriculum reopen
    // (new quizzes clear isCompleted while historical accuracy may still be high).
    const topicMilestoneCompleted =
      totalTopics > 0 && completedTopicCount === totalTopics;

    const requiresProjectApproval = course.hasProject;
    const topicWeight = requiresProjectApproval ? 50 : 100;
    const topicProgressPercent =
      totalTopics > 0
        ? Math.round((completedTopicCount / totalTopics) * topicWeight)
        : 0;
    const projectProgressPercent = hasApprovedProject ? 50 : 0;

    let progressPercent = Math.min(
      100,
      topicProgressPercent + projectProgressPercent,
    );

    let status: CourseProgressStatus = CourseProgressStatus.IN_PROGRESS;

    if (
      topicMilestoneCompleted &&
      requiresProjectApproval &&
      !hasApprovedProject
    ) {
      status = CourseProgressStatus.PROJECT_PENDING_APPROVAL;
      progressPercent = 50;
    }

    if (topicMilestoneCompleted && !requiresProjectApproval) {
      status = CourseProgressStatus.COMPLETED;
      progressPercent = 100;
    }

    if (
      topicMilestoneCompleted &&
      requiresProjectApproval &&
      hasApprovedProject
    ) {
      status = CourseProgressStatus.COMPLETED;
      progressPercent = 100;
    }

    const now = new Date();

    const progress = await this.prisma.userCourseProgress.upsert({
      where: {
        userId_courseId: {
          userId,
          courseId: course.id,
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
          status === CourseProgressStatus.COMPLETED && hasApprovedProject
            ? (approvedReviewedAt ?? now)
            : (existing?.projectApprovedAt ?? null),
        completedAt:
          status === CourseProgressStatus.COMPLETED
            ? (existing?.completedAt ?? now)
            : null,
      },
      create: {
        userId,
        courseId: course.id,
        topicProgressPercent,
        projectProgressPercent,
        progressPercent,
        status,
        topicsCompletedAt: topicMilestoneCompleted ? now : null,
        projectApprovedAt: hasApprovedProject
          ? (approvedReviewedAt ?? now)
          : null,
        completedAt: status === CourseProgressStatus.COMPLETED ? now : null,
      },
    });

    if (
      existing?.status === CourseProgressStatus.COMPLETED &&
      status !== CourseProgressStatus.COMPLETED
    ) {
      this.logger.log(
        `[evaluateCourseProgress] reopen demote userId=${userId} courseId=${course.id} ${existing.status} -> ${status} progress=${progressPercent}`,
      );
    }

    return progress;
  }

  private async maybeIssueCertificateAndSyncProfiles(
    userId: string,
    course: CourseForProgressEval,
    existing: UserCourseProgress | null,
    progress: UserCourseProgress,
    req?: ExpressRequest,
  ): Promise<void> {
    const now = progress.updatedAt ?? new Date();

    if (
      progress.status === CourseProgressStatus.COMPLETED &&
      existing?.status !== CourseProgressStatus.COMPLETED
    ) {
      const existingCertificate = await this.prisma.certificate.findUnique({
        where: {
          userId_courseId: {
            userId,
            courseId: course.id,
          },
        },
        select: { id: true },
      });

      await this.prisma.certificate.upsert({
        where: {
          userId_courseId: {
            userId,
            courseId: course.id,
          },
        },
        update: {
          issuedAt: now,
          metadata: {
            topicProgressPercent: progress.topicProgressPercent,
            projectProgressPercent: progress.projectProgressPercent,
            refreshed: true,
          },
        },
        create: {
          userId,
          courseId: course.id,
          certificateCode: `CRT-${randomUUID()}`,
          issuedAt: now,
          metadata: {
            topicProgressPercent: progress.topicProgressPercent,
            projectProgressPercent: progress.projectProgressPercent,
          },
        },
      });

      // Timeline only on first completion — re-complete after reopen refreshes cert only.
      if (!existingCertificate && req && this.extractUserId(req) === userId) {
        await this.profilesService.createTimelineEvent(req, {
          eventType: 'COURSE_COMPLETE',
          title: `Hoàn thành khóa học ${course.name}`,
          metadata: {
            courseId: course.id,
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

      // Fire-and-forget: Profiles metadata must not block the API response.
      void this.profilesService
        .patchMyMetadata(req, {
          courseProgress: {
            courseId: course.id,
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
        })
        .catch(() => undefined);
    }
  }

  /**
   * If a topic was marked completed before newer quizzes were added,
   * clear sticky completion so course % can drop without waiting for a new attempt.
   */
  private async healStaleTopicCompletions(
    userId: string,
    topicIds: string[],
  ): Promise<void> {
    if (topicIds.length === 0) {
      return;
    }

    const completedProgresses = await this.prisma.topicProgress.findMany({
      where: {
        userId,
        topicId: { in: topicIds },
        isCompleted: true,
      },
      select: {
        topicId: true,
        completedAt: true,
        updatedAt: true,
      },
    });

    if (completedProgresses.length === 0) {
      return;
    }

    const latestQuizByTopic = await this.prisma.quiz.groupBy({
      by: ['topicId'],
      where: {
        topicId: { in: completedProgresses.map((item) => item.topicId) },
      },
      _max: {
        createdAt: true,
      },
    });

    const latestQuizCreatedAt = new Map(
      latestQuizByTopic.map((item) => [item.topicId, item._max.createdAt]),
    );

    const topicIdsToClear = completedProgresses
      .filter((progress) => {
        const latestQuizAt = latestQuizCreatedAt.get(progress.topicId);
        if (!latestQuizAt) {
          return false;
        }

        const completedAt = progress.completedAt ?? progress.updatedAt;
        return latestQuizAt.getTime() > completedAt.getTime();
      })
      .map((progress) => progress.topicId);

    if (topicIdsToClear.length === 0) {
      return;
    }

    await this.prisma.topicProgress.updateMany({
      where: {
        userId,
        topicId: { in: topicIdsToClear },
        isCompleted: true,
      },
      data: {
        isCompleted: false,
        completedAt: null,
      },
    });

    this.logger.log(
      `[healStaleTopicCompletions] userId=${userId} clearedTopics=${topicIdsToClear.length}`,
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
