import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { AxiosError } from 'axios';
import type { Request as ExpressRequest } from 'express';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class ProfilesService {
  private readonly logger = new Logger(ProfilesService.name);

  constructor(private readonly httpService: HttpService) {}

  async patchMyMetadata(
    req: ExpressRequest | undefined,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    if (!req) {
      return;
    }

    const baseUrl =
      process.env.PROFILES_API_BASE_URL ?? 'https://profiles.uside.studio';
    const url = `${baseUrl.replace(/\/$/, '')}/users/me`;

    const authorization = req.headers.authorization;
    const cookies = req.headers.cookie;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (authorization) {
      headers.Authorization = authorization;
    }

    if (cookies) {
      headers.Cookie = cookies;
    }

    try {
      await firstValueFrom(
        this.httpService.patch(
          url,
          {
            metadata,
          },
          {
            headers,
            timeout: Number(process.env.PROFILES_HTTP_TIMEOUT_MS ?? 5000),
          },
        ),
      );
    } catch (error) {
      if (error instanceof AxiosError) {
        this.logger.warn(
          `[patchMyMetadata] upstream status=${error.response?.status ?? 'unknown'}`,
        );
        return;
      }

      this.logger.error('[patchMyMetadata] unexpected error', error as Error);
    }
  }

  async createTimelineEvent(
    req: ExpressRequest | undefined,
    data: {
      eventType: string;
      title: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    if (!req) {
      return;
    }

    const baseUrl =
      process.env.PROFILES_API_BASE_URL ?? 'https://profiles.uside.studio';
    const url = `${baseUrl.replace(/\/$/, '')}/timeline-events`;

    const authorization = req.headers.authorization;
    const cookies = req.headers.cookie;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (authorization) {
      headers.Authorization = authorization;
    }

    if (cookies) {
      headers.Cookie = cookies;
    }

    try {
      await firstValueFrom(
        this.httpService.post(url, data, {
          headers,
          timeout: Number(process.env.PROFILES_HTTP_TIMEOUT_MS ?? 5000),
        }),
      );
    } catch (error) {
      if (error instanceof AxiosError) {
        this.logger.warn(
          `[createTimelineEvent] upstream status=${error.response?.status ?? 'unknown'}`,
        );
        return;
      }

      this.logger.error(
        '[createTimelineEvent] unexpected error',
        error as Error,
      );
    }
  }
}
