import { Module } from '@nestjs/common';
import { OnboardingModule as OnboardingPackageModule } from '@hts/onboarding';
import { OnboardingController } from './controllers/onboarding.controller';

@Module({
  imports: [OnboardingPackageModule],
  controllers: [OnboardingController],
})
export class OnboardingModule {}
