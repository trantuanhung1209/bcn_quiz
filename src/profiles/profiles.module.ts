import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import * as https from 'https';
import { ProfilesService } from './profiles.service';

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
  providers: [ProfilesService],
  exports: [ProfilesService],
})
export class ProfilesModule {}
