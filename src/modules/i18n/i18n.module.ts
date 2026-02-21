import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CountryConfigEntity, CountryService } from '@hts/i18n';
import { I18nController } from './controllers/i18n.controller';

@Module({
  imports: [TypeOrmModule.forFeature([CountryConfigEntity])],
  controllers: [I18nController],
  providers: [CountryService],
  exports: [CountryService],
})
export class I18nModule {}
