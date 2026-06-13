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
import { Throttle } from '@nestjs/throttler';
import type { Request as ExpressRequest } from 'express';
import type { Response as ExpressResponse } from 'express';
import { AuthService } from './auth.service';
import { BearerAuthGuard } from './guards/auth.guard';
import { Public } from './decorators/public.decorator';
import { LoginDto } from './dto/login.dto';
import { VerifyTotpDto } from './dto/verify-totp.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { SendEmailOtpDto } from './dto/send-email-otp.dto';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
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
  @Throttle({ default: { limit: 5, ttl: 60000 } })
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
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('2fa/verify/email')
  async verifyEmail(
    @Body() body: VerifyEmailDto,
    @Request() req: ExpressRequest,
    @Response({ passthrough: true }) res: ExpressResponse,
  ) {
    const { data, setCookies } = await this.authService.verifyEmail(
      body,
      req.headers.cookie,
      req.headers.authorization,
    );

    if (setCookies.length > 0) {
      const normalized = this.normalizeSetCookies(setCookies, req);
      this.warnCookieOverwrite(req, normalized, 'verifyEmail');
      res.setHeader('set-cookie', normalized);
    }

    return data;
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('2fa/send-email-otp')
  async sendEmailOtp(
    @Body() body: SendEmailOtpDto,
    @Request() req: ExpressRequest,
    @Response({ passthrough: true }) res: ExpressResponse,
  ) {
    const { data, setCookies } = await this.authService.sendEmailOtp(
      body,
      req.headers.cookie,
      req.headers.authorization,
    );

    if (setCookies.length > 0) {
      const normalized = this.normalizeSetCookies(setCookies, req);
      this.warnCookieOverwrite(req, normalized, 'sendEmailOtp');
      res.setHeader('set-cookie', normalized);
    }

    return data;
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
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
    const origin = req.headers.origin ?? '';

    // Detect if the request is coming FROM a localhost FE (origin-based),
    // regardless of whether the backend itself is local or production.
    const isLocalhostOrigin =
      origin.includes('localhost') || origin.includes('127.0.0.1');

    // FE is on HTTP (not HTTPS) when origin starts with http:// and is localhost.
    const isLocalhostHttp =
      isLocalhostOrigin && origin.startsWith('http://');

    this.logger.debug(
      `[normalizeSetCookies] origin=${origin} isLocalhostOrigin=${isLocalhostOrigin} isLocalhostHttp=${isLocalhostHttp}`,
    );

    setCookies.forEach((c, i) => {
      this.logger.debug(`[normalizeSetCookies] upstream cookie[${i}]: ${c}`);
    });

    return setCookies.map((cookie) => {
      let normalized = cookie;

      if (isLocalhostOrigin) {
        // Strip Domain=.uside.studio — browser rejects cross-domain cookies for localhost.
        normalized = normalized.replace(/;\s*Domain=[^;]*/gi, '');

        if (isLocalhostHttp) {
          // HTTP localhost: browser rejects cookies with Secure flag or SameSite=None.
          normalized = normalized.replace(/;\s*Secure/gi, '');
          normalized = normalized.replace(/;\s*SameSite=None/gi, '; SameSite=Lax');
        }
        // HTTPS localhost (Vite + mkcert): Secure is fine, SameSite=None is fine too.
      }

      // Production FE on *.uside.studio:
      // keep Domain=.uside.studio intact so the cookie is shared across subdomains.

      this.logger.debug(`[normalizeSetCookies] normalized cookie: ${normalized}`);

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
