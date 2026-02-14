import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { I18nModule as I18nPackageModule } from '@hts/i18n';
import { CountryConfigEntity, CountryService } from '@hts/i18n';
import { I18nController } from './controllers/i18n.controller';

@Module({
  imports: [
    I18nPackageModule,
    TypeOrmModule.forFeature([CountryConfigEntity]),
  ],
  controllers: [I18nController],
  providers: [CountryService],
  exports: [CountryService],
})
export class I18nModule {}
