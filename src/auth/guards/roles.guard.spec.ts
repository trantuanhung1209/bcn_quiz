import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';

function mockContext(user?: unknown): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({
        user,
        method: 'GET',
        originalUrl: '/admin',
      }),
    }),
  } as ExecutionContext;
}

describe('RolesGuard', () => {
  const reflector = {
    getAllAndOverride: jest.fn(),
  };

  let guard: RolesGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new RolesGuard(reflector as unknown as Reflector);
  });

  it('allows public routes without roles', () => {
    reflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === IS_PUBLIC_KEY) return true;
      return undefined;
    });

    expect(guard.canActivate(mockContext())).toBe(true);
  });

  it('allows when no roles are required', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    expect(guard.canActivate(mockContext({ id: 'u1' }))).toBe(true);
  });

  it('allows admin role from nested profiles payload', () => {
    reflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === IS_PUBLIC_KEY) return false;
      if (key === ROLES_KEY) return ['admin'];
      return undefined;
    });

    expect(
      guard.canActivate(
        mockContext({ data: { user: { role: 'Admin' } } }),
      ),
    ).toBe(true);
  });

  it('forbids user without required role', () => {
    reflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === IS_PUBLIC_KEY) return false;
      if (key === ROLES_KEY) return ['admin'];
      return undefined;
    });

    expect(() =>
      guard.canActivate(mockContext({ role: 'user' })),
    ).toThrow(ForbiddenException);
  });

  it('rejects missing authenticated user when roles required', () => {
    reflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === IS_PUBLIC_KEY) return false;
      if (key === ROLES_KEY) return ['admin'];
      return undefined;
    });

    expect(() => guard.canActivate(mockContext())).toThrow(
      UnauthorizedException,
    );
  });
});
