import { IsObject, IsOptional, IsString } from 'class-validator';

export class SaveSessionDto {
  @IsString()
  @IsOptional()
  currentQuizId?: string;

  @IsString()
  @IsOptional()
  selectedAnswer?: string;

  @IsObject()
  @IsOptional()
  answers?: Record<string, string>;
}
