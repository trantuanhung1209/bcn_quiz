import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Roles } from './auth/decorators/roles.decorator';
import { Public } from './auth/decorators/public.decorator';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Public()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('admin')
  @Roles('admin')
  getAdminArea() {
    return {
      message: 'Admin resource granted',
    };
  }
}
