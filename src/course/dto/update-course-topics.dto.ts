import { ArrayNotEmpty, IsArray, IsString } from 'class-validator';

export class UpdateCourseTopicsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  topicIds!: string[];
}
