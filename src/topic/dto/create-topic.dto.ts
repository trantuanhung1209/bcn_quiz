import { IsNotEmpty, IsOptional, IsString, IsUrl } from 'class-validator';

export class CreateTopicDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  slug!: string;

  @IsString()
  @IsNotEmpty()
  courseId!: string;

  @IsOptional()
  @IsUrl({ protocols: ['https'], require_tld: true })
  imageUrl?: string;

  @IsOptional()
  @IsString()
  imagePublicId?: string;
}
