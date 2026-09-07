import { NotFoundException } from '@nestjs/common';
import { CertificateService } from './certificate.service';

describe('CertificateService.verifyByCode', () => {
  const prisma = {
    $queryRaw: jest.fn(),
  };

  let service: CertificateService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CertificateService(prisma as never);
  });

  it('returns public certificate payload', async () => {
    prisma.$queryRaw.mockResolvedValue([
      {
        certificateCode: 'CRT-1',
        issuedAt: new Date('2026-01-01T00:00:00.000Z'),
        course_id: 'c1',
        course_name: 'Nest',
        course_slug: 'nest',
      },
    ]);

    await expect(service.verifyByCode('CRT-1')).resolves.toEqual({
      valid: true,
      certificateCode: 'CRT-1',
      issuedAt: new Date('2026-01-01T00:00:00.000Z'),
      course: { id: 'c1', name: 'Nest', slug: 'nest' },
    });
  });

  it('throws NotFound for unknown codes', async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    await expect(service.verifyByCode('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
