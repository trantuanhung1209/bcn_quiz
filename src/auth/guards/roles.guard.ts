import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';

type UserWithRoles = {
  role?: unknown;
  roles?: unknown;
  data?: {
    role?: unknown;
    roles?: unknown;
    user?: {
      role?: unknown;
      roles?: unknown;
    };
  };
  user?: {
    role?: unknown;
    roles?: unknown;
  };
};

@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const normalizedRequiredRoles = requiredRoles.map((role) =>
      role.toLowerCase(),
    );

    const req = context.switchToHttp().getRequest<Request>();
    const user = req.user as UserWithRoles | undefined;

    if (!user) {
      this.logger.warn(
        `[roles] missing req.user for ${req.method} ${req.originalUrl}`,
      );
      throw new UnauthorizedException('Missing authenticated user');
    }

    const actualRoles = this.extractRoles(user);
    const allowed = normalizedRequiredRoles.some((requiredRole) =>
      actualRoles.includes(requiredRole),
    );

    if (!allowed) {
      this.logger.warn(
        `[roles] forbidden ${req.method} ${req.originalUrl} required=${normalizedRequiredRoles.join(',')} actual=${actualRoles.join(',') || 'none'}`,
      );
      throw new ForbiddenException('Insufficient role permissions');
    }

    return true;
  }

  private extractRoles(user: UserWithRoles): string[] {
    const candidates = [
      user.role,
      user.roles,
      user.user?.role,
      user.user?.roles,
      user.data?.role,
      user.data?.roles,
      user.data?.user?.role,
      user.data?.user?.roles,
    ];

    const normalized: string[] = [];

    for (const candidate of candidates) {
      if (typeof candidate === 'string') {
        normalized.push(candidate.toLowerCase());
      }

      if (Array.isArray(candidate)) {
        for (const role of candidate) {
          if (typeof role === 'string') {
            normalized.push(role.toLowerCase());
          }
        }
      }
    }

    return [...new Set(normalized)];
  }
}