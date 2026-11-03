import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { FeatureFlag } from './feature-flag.entity.js';
import { FeatureFlagRepository } from './feature-flag.repository.js';
import { FlagsService } from './flags.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([FeatureFlag])],
  providers: [FlagsService, FeatureFlagRepository],
  exports: [FlagsService],
})
export class FlagsModule {}
