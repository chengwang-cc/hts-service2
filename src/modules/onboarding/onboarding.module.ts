import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  OnboardingModule as OnboardingPackageModule,
  OnboardingProgressEntity,
  OnboardingTemplateEntity,
  OnboardingService,
  TemplateService,
} from '@hts/onboarding';
import { OnboardingController } from './controllers/onboarding.controller';

@Module({
  imports: [
    // Register entities in the main app context where DataSource is available
    TypeOrmModule.forFeature([
      OnboardingProgressEntity,
      OnboardingTemplateEntity,
    ]),
    OnboardingPackageModule,
  ],
  providers: [
    // Provide services here so they have access to repositories
    OnboardingService,
    TemplateService,
  ],
  controllers: [OnboardingController],
  exports: [
    OnboardingService,
    TemplateService,
  ],
})
export class OnboardingModule {}
