import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateCourseDto {
  @IsString()
  name!: string;

  @IsString()
  slug!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  hasProject?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  topicWeight?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  projectWeight?: number;
}
