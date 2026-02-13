import { Injectable } from '@nestjs/common';
import { Workbook, Worksheet } from 'exceljs';

@Injectable()
export class ExcelExportService {
  /**
   * Generate Excel buffer from records
   */
  async generate(
    records: any[],
    options?: {
      sheetName?: string;
      columns?: Array<{ header: string; key: string; width?: number }>;
      title?: string;
      includeHeader?: boolean;
    },
  ): Promise<Buffer> {
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet(options?.sheetName || 'Export');

    // Add title row if provided
    if (options?.title) {
      worksheet.addRow([options.title]);
      worksheet.getRow(1).font = { bold: true, size: 14 };
      worksheet.addRow([]); // Empty row
    }

    // Configure columns
    if (options?.columns) {
      worksheet.columns = options.columns.map(col => ({
        header: col.header,
        key: col.key,
        width: col.width || 20,
      }));
    } else if (records.length > 0) {
      // Auto-detect columns from first record
      const keys = Object.keys(records[0]);
      worksheet.columns = keys.map(key => ({
        header: key,
        key,
        width: 20,
      }));
    }

    // Style header row
    worksheet.getRow(options?.title ? 3 : 1).font = { bold: true };
    worksheet.getRow(options?.title ? 3 : 1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' },
    };

    // Add data rows
    records.forEach(record => {
      worksheet.addRow(record);
    });

    // Auto-filter
    worksheet.autoFilter = {
      from: { row: options?.title ? 3 : 1, column: 1 },
      to: { row: options?.title ? 3 : 1, column: worksheet.columns.length },
    };

    // Generate buffer
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  /**
   * Generate Excel with multiple sheets
   */
  async generateMultiSheet(sheets: Array<{
    name: string;
    records: any[];
    columns?: Array<{ header: string; key: string; width?: number }>;
  }>): Promise<Buffer> {
    const workbook = new Workbook();

    for (const sheet of sheets) {
      const worksheet = workbook.addWorksheet(sheet.name);

      // Configure columns
      if (sheet.columns) {
        worksheet.columns = sheet.columns.map(col => ({
          header: col.header,
          key: col.key,
          width: col.width || 20,
        }));
      } else if (sheet.records.length > 0) {
        const keys = Object.keys(sheet.records[0]);
        worksheet.columns = keys.map(key => ({
          header: key,
          key,
          width: 20,
        }));
      }

      // Style header
      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' },
      };

      // Add data
      sheet.records.forEach(record => {
        worksheet.addRow(record);
      });

      // Auto-filter
      if (sheet.records.length > 0) {
        worksheet.autoFilter = {
          from: { row: 1, column: 1 },
          to: { row: 1, column: worksheet.columns.length },
        };
      }
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  /**
   * Generate audit pack Excel (multi-sheet with summary)
   */
  async generateAuditPackExcel(data: {
    classification: any;
    history: any[];
    calculations: any[];
  }): Promise<Buffer> {
    const sheets = [
      {
        name: 'Summary',
        records: [{
          'Product Description': data.classification.productDescription,
          'Current HTS Code': data.classification.confirmedHtsCode,
          'Confidence Score': data.classification.confidenceScore,
          'Confirmed Date': data.classification.confirmedAt,
          'Confirmed By': data.classification.confirmedBy?.email,
          'Total Modifications': data.history.length,
          'Total Calculations': data.calculations.length,
        }],
      },
      {
        name: 'Classification History',
        records: data.history.map(h => ({
          'Date': h.createdAt,
          'Action': h.action,
          'Previous HTS': h.previousHtsCode,
          'New HTS': h.newHtsCode,
          'Modified By': h.modifiedBy?.email,
          'Reason': h.reason,
        })),
      },
      {
        name: 'Calculations',
        records: data.calculations.map(c => ({
          'Date': c.createdAt,
          'HTS Code': c.htsCode,
          'Value': c.declaredValue,
          'Origin': c.originCountry,
          'Total Duty': c.results?.totalDuty,
          'Effective Rate': c.results?.effectiveRate,
        })),
      },
    ];

    return this.generateMultiSheet(sheets);
  }
}
