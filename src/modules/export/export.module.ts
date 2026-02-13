import { Module } from '@nestjs/common';
import { ExportPackageModule } from '@hts/export';
import { ExportController } from './controllers/export.controller';

@Module({
  imports: [ExportPackageModule],
  controllers: [ExportController],
})
export class ExportModule {}
