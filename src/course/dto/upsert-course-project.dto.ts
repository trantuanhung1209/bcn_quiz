import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class UpsertCourseProjectDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  @IsNotEmpty()
  description!: string;

  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  /**
   * Optional MinIO secure URL for the requirement brief/spec file.
   * Send together with attachmentPublicId. Send both `null` to remove.
   */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUrl({ protocols: ['https'], require_tld: true })
  attachmentUrl?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @IsNotEmpty()
  attachmentPublicId?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(255)
  attachmentOriginalName?: string | null;
}
