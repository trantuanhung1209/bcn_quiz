import { IsEnum, IsOptional } from 'class-validator';
import { ProjectSubmissionStatus } from '@prisma/client';

export class ListProjectSubmissionsQueryDto {
  @IsOptional()
  @IsEnum(ProjectSubmissionStatus)
  status?: ProjectSubmissionStatus;
}
