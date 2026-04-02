import { IsNotEmpty, IsString } from 'class-validator';

export class CreateTopicDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  slug!: string;
}
