import { CourseProgressStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

export enum MyCourseProgressScope {
  ACTIVE = 'active',
  COMPLETED = 'completed',
}

export class MyCourseProgressQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10;

  /** Exact status filter. Takes precedence over `scope` when both are set. */
  @IsOptional()
  @IsEnum(CourseProgressStatus)
  status?: CourseProgressStatus;

  /**
   * Convenience filter for FE tabs:
   * - `active` = IN_PROGRESS | TOPICS_COMPLETED | PROJECT_PENDING_APPROVAL
   * - `completed` = COMPLETED
   */
  @IsOptional()
  @IsEnum(MyCourseProgressScope)
  scope?: MyCourseProgressScope;
}
