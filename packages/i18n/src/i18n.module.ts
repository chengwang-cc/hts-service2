import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CountryConfigEntity } from './entities/country-config.entity';
import { CountryService } from './services/country.service';

@Module({
  imports: [TypeOrmModule.forFeature([CountryConfigEntity])],
  providers: [CountryService],
  exports: [CountryService],
})
export class I18nModule {}
