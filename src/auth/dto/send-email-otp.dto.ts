import { IsEmail, IsOptional } from 'class-validator';

export class SendEmailOtpDto {
  @IsOptional()
  @IsEmail()
  email?: string;
}
