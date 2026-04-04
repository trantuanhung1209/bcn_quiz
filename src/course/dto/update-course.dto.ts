import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpdateCourseDto {
	@IsOptional()
	@IsString()
	name?: string;

	@IsOptional()
	@IsString()
	slug?: string;

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
