import { Type } from 'class-transformer';
import { IsDate, IsOptional, IsString, IsUrl, ValidateIf } from 'class-validator';

export class UpdateTopicDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  slug?: string;

  @IsOptional()
  @IsUrl({ protocols: ['https'], require_tld: true })
  imageUrl?: string;

  @IsOptional()
  @IsString()
  imagePublicId?: string;

  /** Pass null to clear the schedule bound. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Type(() => Date)
  @IsDate()
  startsAt?: Date | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Type(() => Date)
  @IsDate()
  endsAt?: Date | null;
}
