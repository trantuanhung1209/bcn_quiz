import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CertificateController } from './certificate.controller';
import { CertificateService } from './certificate.service';

@Module({
  controllers: [CertificateController],
  providers: [CertificateService, PrismaService],
  exports: [CertificateService],
})
export class CertificateModule {}
