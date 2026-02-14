import { Module } from '@nestjs/common';

@Module({
  imports: [
    // TypeOrmModule.forFeature() removed - entities registered in wrapper module
    // to ensure DataSource is available in the main app context
  ],
  providers: [
    // Services removed - provided in wrapper module where repositories are available
  ],
  exports: [
    // Services exported from wrapper module instead
  ],
})
export class OnboardingModule {}
