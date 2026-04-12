import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import * as https from 'https';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';

@Module({
  imports: [
    HttpModule.register({
      httpsAgent: new https.Agent({
        keepAlive: true,
        maxSockets: 100,
        keepAliveMsecs: 1000 * 60,
      }),
      timeout: 10000,
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
