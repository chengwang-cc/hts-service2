import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  ExportJobEntity,
  ExportTemplateEntity,
  DataCompletenessCheckEntity,
} from './entities';
import {
  ExportService,
  CsvExportService,
  ExcelExportService,
  DataCompletenessService,
  TemplateRegistryService,
} from './services';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ExportJobEntity,
      ExportTemplateEntity,
      DataCompletenessCheckEntity,
    ]),
  ],
  providers: [
    ExportService,
    CsvExportService,
    ExcelExportService,
    DataCompletenessService,
    TemplateRegistryService,
  ],
  exports: [
    ExportService,
    CsvExportService,
    ExcelExportService,
    DataCompletenessService,
    TemplateRegistryService,
  ],
})
export class ExportPackageModule {}
