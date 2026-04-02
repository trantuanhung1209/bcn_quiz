import {
  Body,
  Controller,
  Get,
  Logger,
  Post,
  Request,
  Response,
  UseGuards,
} from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import type { Response as ExpressResponse } from 'express';
import { AuthService } from './auth.service';
import { BearerAuthGuard } from './guards/auth.guard';
import { Public } from './decorators/public.decorator';
import { LoginDto } from './dto/login.dto';
import { VerifyTotpDto } from './dto/verify-totp.dto';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  async login(
    @Body() body: LoginDto,
    @Request() req: ExpressRequest,
    @Response({ passthrough: true }) res: ExpressResponse,
  ) {
    const { data, setCookies } = await this.authService.login(
      body,
      req.headers.cookie,
    );

    if (setCookies.length > 0) {
      const normalized = this.normalizeSetCookies(setCookies, req);
      this.warnCookieOverwrite(req, normalized, 'login');
      res.setHeader('set-cookie', normalized);
    }

    return data;
  }

  @Public()
  @Post('2fa/verify/totp')
  async verifyTotp(
    @Body() body: VerifyTotpDto,
    @Request() req: ExpressRequest,
    @Response({ passthrough: true }) res: ExpressResponse,
  ) {
    const { data, setCookies } = await this.authService.verifyTotp(
      body,
      req.headers.cookie,
      req.headers.authorization,
    );

    if (setCookies.length > 0) {
      const normalized = this.normalizeSetCookies(setCookies, req);
      this.warnCookieOverwrite(req, normalized, 'verifyTotp');
      res.setHeader('set-cookie', normalized);
    }

    return data;
  }

  @Public()
  @Post('refresh')
  async refresh(
    @Request() req: ExpressRequest,
    @Response({ passthrough: true }) res: ExpressResponse,
  ) {
    const { data, setCookies } = await this.authService.refresh(
      req.headers.cookie,
      req.headers.authorization,
    );

    if (setCookies.length > 0) {
      const normalized = this.normalizeSetCookies(setCookies, req);
      this.warnCookieOverwrite(req, normalized, 'refresh');
      res.setHeader('set-cookie', normalized);
    }

    return data;
  }

  @Public()
  @Post('logout')
  async logout(
    @Request() req: ExpressRequest,
    @Response({ passthrough: true }) res: ExpressResponse,
  ) {
    const { data, setCookies } = await this.authService.logout(
      req.headers.cookie,
      req.headers.authorization,
    );

    if (setCookies.length > 0) {
      const normalized = this.normalizeSetCookies(setCookies, req);
      this.warnCookieOverwrite(req, normalized, 'logout');
      res.setHeader('set-cookie', normalized);
    }

    return data;
  }

  @Get('me')
  @UseGuards(BearerAuthGuard)
  getProfile(@Request() req: ExpressRequest & { user?: unknown }) {
    return req.user;
  }

  private normalizeSetCookies(
    setCookies: string[],
    req: ExpressRequest,
  ): string[] {
    if (process.env.NODE_ENV === 'production') {
      return setCookies;
    }

    const host = req.headers.host ?? '';
    const forwardedProto = req.headers['x-forwarded-proto'];
    const isHttps = req.secure || forwardedProto === 'https';
    const isLocalhost = host.includes('localhost') || host.includes('127.0.0.1');

    if (!isLocalhost) {
      return setCookies;
    }

    return setCookies.map((cookie) => {
      let normalized = cookie.replace(/;\s*Domain=[^;]*/gi, '');

      if (!isHttps) {
        normalized = normalized.replace(/;\s*Secure/gi, '');
        normalized = normalized.replace(/;\s*SameSite=None/gi, '; SameSite=Lax');
      }

      return normalized;
    });
  }

  private warnCookieOverwrite(
    req: ExpressRequest,
    setCookies: string[],
    context: string,
  ): void {
    const incoming = this.parseCookieNames(req.headers.cookie);
    const outgoing = this.parseSetCookieNames(setCookies);
    const overlapped = outgoing.filter((name) => incoming.has(name));

    if (overlapped.length > 0) {
      this.logger.warn(
        `[${context}] cookie overwrite detected names=${overlapped.join(',')} host=${req.headers.host ?? 'unknown'}`,
      );
    }
  }

  private parseCookieNames(cookieHeader?: string): Set<string> {
    if (!cookieHeader) {
      return new Set<string>();
    }

    const names = cookieHeader
      .split(';')
      .map((part) => part.trim())
      .map((part) => part.split('=')[0]?.trim())
      .filter((name): name is string => Boolean(name));

    return new Set(names);
  }

  private parseSetCookieNames(setCookies: string[]): string[] {
    return setCookies
      .map((cookie) => cookie.split(';')[0]?.trim())
      .map((pair) => pair?.split('=')[0]?.trim())
      .filter((name): name is string => Boolean(name));
  }
}
