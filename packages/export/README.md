# @hts/export

Export templates and data completeness validation package for HTS platform.

## Features

- ✅ **Multiple Export Formats**: CSV, Excel, PDF, JSON
- ✅ **Pre-built Templates**: Shopify, Broker, Customs, Audit Pack, Invoice, Packing List
- ✅ **Custom Templates**: Create organization-specific export templates
- ✅ **Data Completeness**: Validate data before export with scoring
- ✅ **Background Jobs**: Async export processing for large datasets
- ✅ **Job Tracking**: Real-time progress monitoring

## Installation

```bash
npm install @hts/export
```

## Usage

### Import Module

```typescript
import { Module } from '@nestjs/common';
import { ExportPackageModule } from '@hts/export';

@Module({
  imports: [ExportPackageModule],
})
export class AppModule {}
```

### Create Export Job

```typescript
import { ExportService, ExportRequestDto } from '@hts/export';

@Injectable()
export class MyService {
  constructor(private readonly exportService: ExportService) {}

  async exportClassifications(organizationId: string, userId: string) {
    const request: ExportRequestDto = {
      format: 'csv',
      template: 'shopify',
      filters: {
        dateRange: {
          start: new Date('2025-01-01'),
          end: new Date('2025-12-31'),
        },
      },
    };

    return this.exportService.createExportJob(organizationId, userId, request);
  }
}
```

### Check Data Completeness

```typescript
import { DataCompletenessService } from '@hts/export';

@Injectable()
export class MyService {
  constructor(private readonly completenessService: DataCompletenessService) {}

  async checkClassification(organizationId: string, classification: any) {
    return this.completenessService.checkResource(
      organizationId,
      'classification',
      classification,
    );
  }
}
```

### Generate Export Synchronously

```typescript
import { CsvExportService } from '@hts/export';

@Injectable()
export class MyService {
  constructor(private readonly csvService: CsvExportService) {}

  async exportToShopify(classifications: any[]): Promise<Buffer> {
    return this.csvService.generateShopifyExport(classifications);
  }
}
```

## Available Templates

### System Templates

1. **Shopify Product Export** - Standard Shopify format with HS codes
2. **Customs Broker Export** - ACE PGA compatible format
3. **Classification Audit Pack** - Complete classification history and audit trail

### Custom Templates

Create your own templates using the Template Registry:

```typescript
import { TemplateRegistryService, CreateTemplateDto } from '@hts/export';

const template: CreateTemplateDto = {
  name: 'My Custom Export',
  templateType: 'custom',
  fieldMapping: {
    'Custom Field 1': { sourceField: 'productDescription', required: true },
    'Custom Field 2': { sourceField: 'htsCode', transform: 'uppercase' },
  },
  formatOptions: {
    delimiter: '|',
    includeHeader: true,
  },
};

await templateService.createTemplate(organizationId, template);
```

## API Reference

### ExportService

- `createExportJob(orgId, userId, request)` - Create export job
- `getJobStatus(jobId)` - Get job progress
- `listExportJobs(orgId, options)` - List organization's export jobs
- `generateExport(template, format, data)` - Sync export for small datasets

### DataCompletenessService

- `checkResource(orgId, type, resource)` - Check single resource
- `checkBatch(orgId, type, resources)` - Check multiple resources
- `getLatestCheck(type, resourceId)` - Get latest check result
- `getCheckHistory(type, resourceId)` - Get check history

### CsvExportService

- `generate(records, options)` - Generic CSV generation
- `generateShopifyExport(classifications)` - Shopify format
- `generateBrokerExport(calculations)` - Broker format
- `generateAuditPack(classification)` - Audit pack format

### ExcelExportService

- `generate(records, options)` - Generic Excel generation
- `generateMultiSheet(sheets)` - Multiple sheets
- `generateAuditPackExcel(data)` - Audit pack with multiple sheets

## Database Entities

### ExportJobEntity

Tracks export job status and results.

**Fields:**
- `id` - UUID
- `organizationId` - Organization reference
- `template` - Template name
- `format` - Export format (csv, excel, pdf, json)
- `status` - Job status (pending, processing, completed, failed)
- `fileUrl` - Download URL when completed
- `recordCount` - Total records to export
- `completedAt` - Completion timestamp

### DataCompletenessCheckEntity

Stores completeness check results.

**Fields:**
- `resourceType` - Type of resource (classification, calculation, product)
- `resourceId` - Resource UUID
- `overallScore` - Completeness score (0-100)
- `isExportReady` - Boolean indicating export readiness
- `issues` - Array of validation issues

## Development

```bash
# Build
npm run build

# Watch mode
npm run build:watch

# Test
npm test

# Lint
npm run lint
```

## License

PROPRIETARY - HTS Platform
