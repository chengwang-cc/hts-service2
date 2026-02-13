import { Module } from '@nestjs/common';
import { I18nModule as I18nPackageModule } from '@hts/i18n';
import { I18nController } from './controllers/i18n.controller';

@Module({
  imports: [I18nPackageModule],
  controllers: [I18nController],
})
export class I18nModule {}
