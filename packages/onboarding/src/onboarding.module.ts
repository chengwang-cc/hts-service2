import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OnboardingProgressEntity } from './entities/onboarding-progress.entity';
import { OnboardingTemplateEntity } from './entities/onboarding-template.entity';
import { OnboardingService } from './services/onboarding.service';
import { TemplateService } from './services/template.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      OnboardingProgressEntity,
      OnboardingTemplateEntity,
    ]),
  ],
  providers: [OnboardingService, TemplateService],
  exports: [OnboardingService, TemplateService],
})
export class OnboardingModule {}
