import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { AxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';
import { LoginDto } from './dto/login.dto';
import { VerifyTotpDto } from './dto/verify-totp.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { SendEmailOtpDto } from './dto/send-email-otp.dto';
import { appendBearerTokenAsCookie } from './auth-header.util';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly baseUrl = process.env.PROFILES_API_BASE_URL;

  constructor(private readonly httpService: HttpService) {}

  async login(
    payload: LoginDto,
    cookies?: string,
  ): Promise<{ data: unknown; setCookies: string[] }> {
    this.logger.log(
      `[login] forward to profiles auth/login email=${payload.email} hasCookie=${Boolean(cookies)}`,
    );

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (cookies) {
        headers.Cookie = cookies;
      }

      const response = await firstValueFrom(
        this.httpService.post(`${this.baseUrl}/auth/login`, payload, {
          headers,
        }),
      );

      const setCookies = (response.headers['set-cookie'] as string[] | undefined) ??
        [];

      this.logger.log(
        `[login] success status=${response.status} setCookieCount=${setCookies.length}`,
      );

      return {
        data: response.data,
        setCookies,
      };
    } catch (error) {
      this.throwUpstreamAuthError(error, 'login', 'Login failed');
    }
  }

  async verifyTotp(
    payload: VerifyTotpDto,
    cookies?: string,
    authorization?: string,
  ): Promise<{ data: unknown; setCookies: string[] }> {
    this.logger.log(
      `[verifyTotp] forward to profiles auth/2fa/verify/totp hasCookie=${Boolean(cookies)} hasAuthorization=${Boolean(authorization)}`,
    );

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (cookies) {
        headers.Cookie = cookies;
      }

      if (authorization) {
        headers.Authorization = authorization;
      }

      const response = await firstValueFrom(
        this.httpService.post(
          `${this.baseUrl}/auth/2fa/verify/totp`,
          payload,
          { headers },
        ),
      );

      const setCookies =
        (response.headers['set-cookie'] as string[] | undefined) ?? [];

      this.logger.log(
        `[verifyTotp] success status=${response.status} setCookieCount=${setCookies.length}`,
      );

      return {
        data: response.data,
        setCookies,
      };
    } catch (error) {
      this.throwUpstreamAuthError(error, 'verifyTotp', 'TOTP verification failed');
    }
  }

  async verifyEmail(
    payload: VerifyEmailDto,
    cookies?: string,
    authorization?: string,
  ): Promise<{ data: unknown; setCookies: string[] }> {
    this.logger.log(
      `[verifyEmail] forward to profiles auth/2fa/verify/email hasCookie=${Boolean(cookies)} hasAuthorization=${Boolean(authorization)}`,
    );

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (cookies) {
        headers.Cookie = cookies;
      }

      if (authorization) {
        headers.Authorization = authorization;
      }

      const response = await firstValueFrom(
        this.httpService.post(
          `${this.baseUrl}/auth/2fa/verify/email`,
          payload,
          { headers },
        ),
      );

      const setCookies =
        (response.headers['set-cookie'] as string[] | undefined) ?? [];

      this.logger.log(
        `[verifyEmail] success status=${response.status} setCookieCount=${setCookies.length}`,
      );

      return {
        data: response.data,
        setCookies,
      };
    } catch (error) {
      this.throwUpstreamAuthError(error, 'verifyEmail', 'Email verification failed');
    }
  }

  async sendEmailOtp(
    payload: SendEmailOtpDto,
    cookies?: string,
    authorization?: string,
  ): Promise<{ data: unknown; setCookies: string[] }> {
    this.logger.log(
      `[sendEmailOtp] forward to profiles auth/2fa/send-email-otp hasCookie=${Boolean(cookies)} hasAuthorization=${Boolean(authorization)}`,
    );

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (cookies) {
        headers.Cookie = cookies;
      }

      if (authorization) {
        headers.Authorization = authorization;
      }

      const response = await firstValueFrom(
        this.httpService.post(
          `${this.baseUrl}/auth/2fa/send-email-otp`,
          payload,
          { headers },
        ),
      );

      const setCookies =
        (response.headers['set-cookie'] as string[] | undefined) ?? [];

      this.logger.log(
        `[sendEmailOtp] success status=${response.status} setCookieCount=${setCookies.length}`,
      );

      return {
        data: response.data,
        setCookies,
      };
    } catch (error) {
      this.throwUpstreamAuthError(error, 'sendEmailOtp', 'Send email OTP failed');
    }
  }

  async refresh(
    cookies?: string,
    authorization?: string,
  ): Promise<{ data: unknown; setCookies: string[] }> {
    this.logger.log(
      `[refresh] forward to profiles auth/refresh hasCookie=${Boolean(cookies)} hasAuthorization=${Boolean(authorization)}`,
    );

    const hasRefreshToken = cookies?.toLowerCase().includes('refresh') || authorization;
    if (!hasRefreshToken) {
      this.logger.warn('[refresh] Missing refresh token in cookies and authorization header');
      throw new UnauthorizedException({
        message: 'No refresh token provided',
        code: 'MISSING_REFRESH_TOKEN',
      });
    }

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (cookies) {
        headers.Cookie = cookies;
      }

      if (authorization) {
        headers.Authorization = authorization;
      }

      const response = await firstValueFrom(
        this.httpService.post(
          `${this.baseUrl}/auth/refresh`,
          {},
          {
            headers,
          },
        ),
      );

      const setCookies =
        (response.headers['set-cookie'] as string[] | undefined) ?? [];

      this.logger.log(
        `[refresh] success status=${response.status} setCookieCount=${setCookies.length}`,
      );

      return {
        data: response.data,
        setCookies,
      };
    } catch (error) {
      this.logger.warn('[refresh] Refresh token failed upstream');
      if (error instanceof AxiosError && error.response?.status === 401) {
        throw new UnauthorizedException({
          message: 'Invalid or expired refresh token',
          code: 'INVALID_REFRESH_TOKEN',
          details: this.getUpstreamErrorDetails(error.response?.data),
        });
      }
      this.throwUpstreamAuthError(error, 'refresh', 'Refresh token failed');
    }
  }

  async logout(
    cookies?: string,
    authorization?: string,
  ): Promise<{ data: unknown; setCookies: string[] }> {
    this.logger.log(
      `[logout] forward to profiles auth/logout hasCookie=${Boolean(cookies)} hasAuthorization=${Boolean(authorization)}`,
    );

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (cookies) {
        headers.Cookie = cookies;
      }

      if (authorization) {
        headers.Authorization = authorization;
      }

      const response = await firstValueFrom(
        this.httpService.post(
          `${this.baseUrl}/auth/logout`,
          {},
          {
            headers,
          },
        ),
      );

      const setCookies =
        (response.headers['set-cookie'] as string[] | undefined) ?? [];

      this.logger.log(
        `[logout] success status=${response.status} setCookieCount=${setCookies.length}`,
      );

      return {
        data: response.data,
        setCookies,
      };
    } catch (error) {
      this.throwUpstreamAuthError(error, 'logout', 'Logout failed');
    }
  }

  async validateToken(
    token?: string,
    cookies?: string,
    authorization?: string,
  ): Promise<unknown> {
    if (!token && !cookies && !authorization) {
      this.logger.warn('[validateToken] missing token and cookie');
      throw new UnauthorizedException('Missing authentication token/cookie');
    }

    this.logger.log(
      `[validateToken] forward to profiles auth/me hasToken=${Boolean(token)} hasCookie=${Boolean(cookies)} hasAuthorization=${Boolean(authorization)}`,
    );

    try {
      const headers: Record<string, string> = {};

      const authHeader =
        authorization ?? (token ? `Bearer ${token}` : undefined);

      if (authHeader) {
        headers.Authorization = authHeader;
      }

      const cookieHeader = appendBearerTokenAsCookie(
        cookies,
        authHeader,
        'access_token',
      );

      if (cookieHeader) {
        headers.Cookie = cookieHeader;
      }

      const response = await firstValueFrom(
        this.httpService.get(`${this.baseUrl}/auth/me`, {
          headers,
        }),
      );

      this.logger.log(`[validateToken] success status=${response.status}`);
      return response.data;
    } catch (error) {
      this.throwUpstreamAuthError(
        error,
        'validateToken',
        'Invalid token or unauthorized',
      );
    }
  }

  private throwUpstreamAuthError(
    error: unknown,
    context: string,
    fallbackMessage: string,
  ): never {
    if (error instanceof AxiosError) {
      const status = error.response?.status ?? 500;
      const details = this.getUpstreamErrorDetails(error.response?.data);

      this.logger.warn(`[${context}] upstream status=${status} details=${details}`);
      throw new UnauthorizedException(fallbackMessage);
    }

    this.logger.error(`[${context}] unexpected error`, error as Error);
    throw new UnauthorizedException(fallbackMessage);
  }

  private getUpstreamErrorDetails(data: unknown): string {
    if (!data) {
      return 'no-response-body';
    }

    if (typeof data === 'string') {
      return data;
    }

    if (typeof data === 'object') {
      const normalized = data as { message?: unknown; error?: unknown };

      if (typeof normalized.message === 'string') {
        return normalized.message;
      }

      if (typeof normalized.error === 'string') {
        return normalized.error;
      }
    }

    return 'unrecognized-error-body';
  }
}
