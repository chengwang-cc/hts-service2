import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExtensionController } from './controllers/extension.controller';
import { DetectionService } from './services/detection.service';
import { ExtensionFeedbackEntity } from './entities/extension-feedback.entity';

/**
 * Extension Module
 * Provides API endpoints for Chrome extension support
 */
@Module({
  imports: [TypeOrmModule.forFeature([ExtensionFeedbackEntity])],
  controllers: [ExtensionController],
  providers: [DetectionService],
  exports: [DetectionService],
})
export class ExtensionModule {}
