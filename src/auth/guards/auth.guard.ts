import {
	CanActivate,
	ExecutionContext,
	Injectable,
	Logger,
	UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AuthService } from '../auth.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class BearerAuthGuard implements CanActivate {
	private readonly logger = new Logger(BearerAuthGuard.name);

	constructor(
		private readonly authService: AuthService,
		private readonly reflector: Reflector,
	) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
			context.getHandler(),
			context.getClass(),
		]);

		if (isPublic) {
			this.logger.log('[guard] public route skip auth');
			return true;
		}

		const req = context.switchToHttp().getRequest<Request>();
		const cookieHeader = req.headers.cookie ?? '';
		const authorization = req.headers.authorization;
		const bearerToken = this.extractBearerToken(authorization);
		const cookieToken = this.extractCookieToken(cookieHeader);
		const token = bearerToken ?? cookieToken;
		const tokenSource = bearerToken ? 'bearer' : cookieToken ? 'cookie' : 'none';

		this.logger.log(
			`[guard] authenticate ${req.method} ${req.originalUrl} tokenSource=${tokenSource}`,
		);

		try {
			if (!token && !cookieHeader) {
				this.logger.warn(
					`[guard] missing credentials for ${req.method} ${req.originalUrl}`,
				);
			}

			req.user = (await this.authService.validateToken(
				token,
				cookieHeader,
				authorization,
			)) as Express.User;

			this.logger.log(
				`[guard] auth success ${req.method} ${req.originalUrl} tokenSource=${tokenSource}`,
			);
			return true;
		} catch {
			this.logger.warn(
				`[guard] auth failed ${req.method} ${req.originalUrl} tokenSource=${tokenSource}`,
			);
			throw new UnauthorizedException('Invalid token or unauthorized');
		}
	}

	private extractBearerToken(authorization?: string): string | undefined {
		if (!authorization?.startsWith('Bearer ')) {
			return undefined;
		}

		const token = authorization.slice(7).trim();
		return token.length > 0 ? token : undefined;
	}

	private extractCookieToken(cookieHeader: string): string | undefined {
		if (!cookieHeader) {
			return undefined;
		}

		const cookies = cookieHeader.split(';').map((part) => part.trim());
		const tokenKeys = ['token', 'accessToken', 'access_token'];

		for (const key of tokenKeys) {
			const matched = cookies.find((part) => part.startsWith(`${key}=`));
			if (matched) {
				return decodeURIComponent(matched.slice(`${key}=`.length));
			}
		}

		return undefined;
	}
}
