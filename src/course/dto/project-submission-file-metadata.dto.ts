import { IsInt, IsString, IsUrl, Max, Min } from 'class-validator';

export class ProjectSubmissionFileMetadataDto {
  @IsString()
  @IsUrl({ require_protocol: true })
  secureUrl!: string;

  @IsString()
  publicId!: string;

  @IsString()
  originalName!: string;

  @IsString()
  mimeType!: string;

  @IsInt()
  @Min(1)
  @Max(20 * 1024 * 1024)
  fileSize!: number;
}
