import { Module } from '@nestjs/common';
import {
  ExportService,
  CsvExportService,
  ExcelExportService,
  DataCompletenessService,
  TemplateRegistryService,
} from './services';

@Module({
  imports: [
    // Note: TypeOrmModule.forFeature() registration moved to wrapper module
    // to ensure DataSource is available in the main app context
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
