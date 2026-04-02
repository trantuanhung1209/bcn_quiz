import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-http-bearer';
import { AuthService } from '../auth.service';
import { Request } from 'express';

@Injectable()
export class BearerStrategy extends PassportStrategy(Strategy) {
  constructor(private authService: AuthService) {
    super({ passReqToCallback: true });
  }

  async validate(req: Request, token: string) {
    try {
      // Lấy cookies từ request
      const cookies = req.headers.cookie || '';
      const user = await this.authService.validateToken(token, cookies);
      return user;
    } catch (error) {
      throw new UnauthorizedException('Invalid token or unauthorized');
    }
  }
}
