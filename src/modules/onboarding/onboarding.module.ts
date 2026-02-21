import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  OnboardingProgressEntity,
  OnboardingTemplateEntity,
  OnboardingService,
  TemplateService,
} from '@hts/onboarding';
import { OnboardingController } from './controllers/onboarding.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      OnboardingProgressEntity,
      OnboardingTemplateEntity,
    ]),
  ],
  providers: [OnboardingService, TemplateService],
  controllers: [OnboardingController],
  exports: [OnboardingService, TemplateService],
})
export class OnboardingModule {}
