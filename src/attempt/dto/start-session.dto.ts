import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class StartSessionDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(240)
  expiresInMinutes?: number = 30;
}
