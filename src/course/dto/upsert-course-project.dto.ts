import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

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
}
