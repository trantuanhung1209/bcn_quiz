import { Controller, Get, Request } from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { CertificateService } from './certificate.service';

@Controller('certificate')
export class CertificateController {
  constructor(private readonly certificateService: CertificateService) {}

  @Get('me')
  async getMyCertificates(@Request() req: ExpressRequest) {
    return this.certificateService.getMyCertificates(req);
  }
}
