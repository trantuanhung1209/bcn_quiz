import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ProfilesService } from './profiles.service';

@Module({
  imports: [HttpModule],
  providers: [ProfilesService],
  exports: [ProfilesService],
})
export class ProfilesModule {}
