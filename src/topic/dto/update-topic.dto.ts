import { IsOptional, IsString, IsUrl } from 'class-validator';

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
}
