import { UnauthorizedException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { AxiosError, AxiosHeaders } from 'axios';
import { AuthService } from './auth.service';

describe('AuthService.validateToken cache', () => {
  const httpService = {
    get: jest.fn(),
  } as unknown as HttpService;

  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AUTH_CACHE_TTL_MS = '60000';
    process.env.AUTH_CACHE_MAX_ENTRIES = '100';
    process.env.PROFILES_API_BASE_URL = 'https://profiles.example.com';
    service = new AuthService(httpService);
  });

  it('calls profiles /auth/me only once for the same token within TTL', async () => {
    (httpService.get as jest.Mock).mockReturnValue(
      of({
        status: 200,
        data: { id: 'u1', role: 'user' },
        headers: {},
      }),
    );

    const first = await service.validateToken('token-1');
    const second = await service.validateToken('token-1');

    expect(first).toEqual({ id: 'u1', role: 'user' });
    expect(second).toEqual({ id: 'u1', role: 'user' });
    expect(httpService.get).toHaveBeenCalledTimes(1);
  });

  it('does not cache failed validations', async () => {
    const axiosError = new AxiosError('Unauthorized');
    axiosError.response = {
      status: 401,
      data: { message: 'invalid' },
      statusText: 'Unauthorized',
      headers: {},
      config: { headers: new AxiosHeaders() },
    };

    (httpService.get as jest.Mock)
      .mockReturnValueOnce(throwError(() => axiosError))
      .mockReturnValueOnce(
        of({
          status: 200,
          data: { id: 'u2' },
          headers: {},
        }),
      );

    await expect(service.validateToken('bad-then-good')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    await expect(service.validateToken('bad-then-good')).resolves.toEqual({
      id: 'u2',
    });
    expect(httpService.get).toHaveBeenCalledTimes(2);
  });

  it('invalidates cache on logout so next request revalidates', async () => {
    (httpService.get as jest.Mock).mockReturnValue(
      of({
        status: 200,
        data: { id: 'u3' },
        headers: {},
      }),
    );
    (httpService as { post?: jest.Mock }).post = jest.fn().mockReturnValue(
      of({
        status: 200,
        data: { ok: true },
        headers: {},
      }),
    );

    await service.validateToken(undefined, undefined, 'Bearer logout-token');
    await service.logout(undefined, 'Bearer logout-token');
    await service.validateToken(undefined, undefined, 'Bearer logout-token');

    expect(httpService.get).toHaveBeenCalledTimes(2);
  });
});
