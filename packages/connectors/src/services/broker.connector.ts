import { Injectable } from '@nestjs/common';
import { stringify } from 'csv-stringify/sync';

export interface BrokerLineItem {
  lineNumber: number;
  htsNumber: string; // 10-digit format
  description: string;
  quantity: number;
  uom: string; // Unit of measure
  value: number;
  originCountry: string;
  manufacturer?: string;
  supplierInfo?: {
    name: string;
    address: string;
    country: string;
  };
  additionalAttributes?: Record<string, any>;
}

export interface BrokerExportFormat {
  format: 'ace-pga' | 'customs-broker-csv' | 'ace-entry';
  lineItems: BrokerLineItem[];
  metadata: {
    entryNumber?: string;
    importerOfRecord?: string;
    consignee?: string;
    port?: string;
    entryDate?: string;
  };
}

@Injectable()
export class BrokerConnector {
  /**
   * Generate ACE PGA format export
   */
  async generateAcePgaFormat(data: BrokerExportFormat): Promise<string> {
    const records = data.lineItems.map((item) => ({
      'Line Number': item.lineNumber,
      'HTS Number': this.formatHtsForBroker(item.htsNumber),
      Description: item.description,
      Quantity: item.quantity,
      UOM: item.uom,
      'Value (USD)': item.value.toFixed(2),
      'Country of Origin': item.originCountry,
      Manufacturer: item.manufacturer || '',
      'Entry Number': data.metadata.entryNumber || '',
      'Importer of Record': data.metadata.importerOfRecord || '',
    }));

    return stringify(records, {
      header: true,
      columns: [
        'Line Number',
        'HTS Number',
        'Description',
        'Quantity',
        'UOM',
        'Value (USD)',
        'Country of Origin',
        'Manufacturer',
        'Entry Number',
        'Importer of Record',
      ],
    });
  }

  /**
   * Generate standard customs broker CSV
   */
  async generateBrokerCsv(data: BrokerExportFormat): Promise<string> {
    const records = data.lineItems.map((item) => ({
      'Item #': item.lineNumber,
      'HTS Code': item.htsNumber,
      'Product Description': item.description,
      Qty: item.quantity,
      Unit: item.uom,
      'Unit Value': (item.value / item.quantity).toFixed(2),
      'Total Value': item.value.toFixed(2),
      Origin: item.originCountry,
      'Manufacturer Name': item.manufacturer || 'N/A',
      'Supplier Name': item.supplierInfo?.name || 'N/A',
      'Supplier Country': item.supplierInfo?.country || item.originCountry,
    }));

    return stringify(records, { header: true });
  }

  /**
   * Generate ACE entry format (pipe-delimited)
   */
  async generateAceEntryFormat(data: BrokerExportFormat): Promise<string> {
    const lines: string[] = [];

    // Header record
    lines.push([
      'H', // Record type
      data.metadata.entryNumber || '',
      data.metadata.port || '',
      data.metadata.entryDate || new Date().toISOString().split('T')[0],
      data.metadata.importerOfRecord || '',
    ].join('|'));

    // Line item records
    data.lineItems.forEach((item) => {
      lines.push([
        'L', // Record type
        item.lineNumber,
        this.formatHtsForBroker(item.htsNumber),
        this.escapeForPipe(item.description),
        item.quantity,
        item.uom,
        item.value.toFixed(2),
        item.originCountry,
        this.escapeForPipe(item.manufacturer || ''),
      ].join('|'));
    });

    // Trailer record
    lines.push([
      'T', // Record type
      data.lineItems.length, // Total lines
      data.lineItems.reduce((sum, item) => sum + item.value, 0).toFixed(2), // Total value
    ].join('|'));

    return lines.join('\n');
  }

  /**
   * Validate broker export data
   */
  validateBrokerData(data: BrokerExportFormat): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if (!data.lineItems || data.lineItems.length === 0) {
      errors.push('No line items provided');
    }

    data.lineItems.forEach((item, index) => {
      if (!item.htsNumber || !/^\d{10}$/.test(item.htsNumber)) {
        errors.push(`Line ${index + 1}: Invalid HTS number format (must be 10 digits)`);
      }

      if (!item.description || item.description.trim().length === 0) {
        errors.push(`Line ${index + 1}: Description is required`);
      }

      if (!item.quantity || item.quantity <= 0) {
        errors.push(`Line ${index + 1}: Quantity must be greater than 0`);
      }

      if (!item.value || item.value <= 0) {
        errors.push(`Line ${index + 1}: Value must be greater than 0`);
      }

      if (!item.originCountry || !/^[A-Z]{2}$/.test(item.originCountry)) {
        errors.push(`Line ${index + 1}: Invalid country code (must be 2-letter ISO code)`);
      }

      if (!item.uom || item.uom.trim().length === 0) {
        errors.push(`Line ${index + 1}: Unit of measure is required`);
      }
    });

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Format HTS code for broker (remove dots, ensure 10 digits)
   */
  private formatHtsForBroker(htsCode: string): string {
    // Remove dots and ensure 10 digits
    let formatted = htsCode.replace(/\./g, '');

    // Pad with zeros if needed
    while (formatted.length < 10) {
      formatted += '0';
    }

    // Truncate if too long
    return formatted.substring(0, 10);
  }

  /**
   * Escape pipe characters for pipe-delimited format
   */
  private escapeForPipe(value: string): string {
    return value.replace(/\|/g, '\\|');
  }

  /**
   * Parse broker response/import file
   */
  async parseBrokerImport(csvContent: string): Promise<BrokerLineItem[]> {
    // This would parse a broker's response file
    // Implementation depends on broker format
    // For now, return empty array
    return [];
  }

  /**
   * Get supported formats
   */
  getSupportedFormats(): Array<{
    format: string;
    name: string;
    description: string;
  }> {
    return [
      {
        format: 'ace-pga',
        name: 'ACE PGA Format',
        description: 'Standard ACE Partner Government Agency format',
      },
      {
        format: 'customs-broker-csv',
        name: 'Customs Broker CSV',
        description: 'Generic customs broker CSV format',
      },
      {
        format: 'ace-entry',
        name: 'ACE Entry Format',
        description: 'Pipe-delimited ACE entry format',
      },
    ];
  }
}
