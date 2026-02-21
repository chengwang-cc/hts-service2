import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  ExportJobEntity,
  ExportTemplateEntity,
  DataCompletenessCheckEntity,
  ExportService,
  CsvExportService,
  ExcelExportService,
  DataCompletenessService,
  TemplateRegistryService,
} from '@hts/export';
import { ExportController } from './controllers/export.controller';

@Module({
  imports: [
    // Register entities in the main app context where DataSource is available
    TypeOrmModule.forFeature([
      ExportJobEntity,
      ExportTemplateEntity,
      DataCompletenessCheckEntity,
    ]),
  ],
  providers: [
    // Provide services here so they have access to repositories
    ExportService,
    CsvExportService,
    ExcelExportService,
    DataCompletenessService,
    TemplateRegistryService,
  ],
  controllers: [ExportController],
  exports: [
    ExportService,
    CsvExportService,
    ExcelExportService,
    DataCompletenessService,
    TemplateRegistryService,
  ],
})
export class ExportModule {}
