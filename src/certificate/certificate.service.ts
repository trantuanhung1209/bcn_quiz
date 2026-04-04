import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CertificateService {
  constructor(private readonly prisma: PrismaService) {}

  async getMyCertificates(req: ExpressRequest) {
    const userId = this.extractUserId(req);

    return this.prisma.certificate.findMany({
      where: { userId },
      orderBy: { issuedAt: 'desc' },
      include: {
        course: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });
  }

  extractUserId(req: ExpressRequest): string {
    const user = (req as ExpressRequest & { user?: any }).user;
    const candidates = [
      user?.id,
      user?.sub,
      user?.user?.id,
      user?.data?.id,
      user?.data?.user?.id,
    ];

    const userId = candidates.find(
      (value): value is string =>
        typeof value === 'string' && value.trim().length > 0,
    );

    if (!userId) {
      throw new ForbiddenException('Unable to resolve authenticated user id');
    }

    return userId;
  }
}
