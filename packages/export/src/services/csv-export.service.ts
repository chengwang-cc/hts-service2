import { Injectable } from '@nestjs/common';
import { stringify } from 'csv-stringify/sync';

@Injectable()
export class CsvExportService {
  /**
   * Generate CSV buffer from records
   */
  generate(records: any[], options?: {
    columns?: string[];
    header?: boolean;
    delimiter?: string;
    quoted?: boolean;
  }): Buffer {
    const csvString = stringify(records, {
      header: options?.header ?? true,
      columns: options?.columns,
      delimiter: options?.delimiter ?? ',',
      quoted: options?.quoted ?? true,
      quoted_empty: true,
      quoted_string: true,
    });

    return Buffer.from(csvString, 'utf-8');
  }

  /**
   * Generate Shopify product export CSV
   */
  generateShopifyExport(classifications: any[]): Buffer {
    const records = classifications.map(c => ({
      'Product Title': c.productDescription || '',
      'HS Code': c.confirmedHtsCode || c.suggestedHtsCode || '',
      'Country of Origin': c.originCountry || '',
      'Customs Description': this.buildCustomsDescription(c),
      'Harmonized Code': (c.confirmedHtsCode || c.suggestedHtsCode || '').replace(/\./g, ''),
      'Variant SKU': c.sku || '',
      'Tariff Code': c.confirmedHtsCode || c.suggestedHtsCode || '',
    }));

    return this.generate(records, { header: true });
  }

  /**
   * Generate broker/customs CSV (ACE PGA format compatible)
   */
  generateBrokerExport(calculations: any[]): Buffer {
    const records = calculations.map(c => ({
      'Entry Number': '',
      'Line Number': '',
      'HTS Number': c.htsCode || '',
      'Description': c.productDescription || '',
      'Quantity': c.quantity || 0,
      'UOM': c.unitOfMeasure || 'EA',
      'Value': c.declaredValue || 0,
      'Country of Origin': c.originCountry || '',
      'Duty Rate': c.results?.effectiveRate || '0%',
      'Duty Amount': c.results?.totalDuty || 0,
      'Manufacturer ID': c.metadata?.manufacturerId || '',
      'AD/CVD Case Number': this.getAdCvdCaseNumber(c),
    }));

    return this.generate(records, { header: true });
  }

  /**
   * Generate audit pack CSV
   */
  generateAuditPack(classification: any): Buffer {
    const records = [{
      'Classification Date': classification.confirmedAt || classification.createdAt,
      'Product Description': classification.productDescription || '',
      'Suggested HTS': classification.suggestedHtsCode || '',
      'Confidence Score': classification.confidenceScore || 0,
      'Confirmed HTS': classification.confirmedHtsCode || '',
      'Confirmed By': classification.confirmedBy?.email || '',
      'Confirmed By Name': classification.confirmedBy?.name || '',
      'Attributes Provided': JSON.stringify(classification.attributes || {}),
      'AI Reasoning': classification.aiReasoning || '',
      'Tariff Version': classification.tariffVersion || '',
      'Engine Version': classification.engineVersion || '',
      'Review Notes': classification.reviewNotes || '',
      'Supporting Documents': classification.documentUrls?.join('; ') || '',
      'Origin Country': classification.originCountry || '',
      'Product Images': classification.imageUrls?.join('; ') || '',
    }];

    return this.generate(records, { header: true });
  }

  /**
   * Generate customs declaration CSV
   */
  generateCustomsExport(calculations: any[]): Buffer {
    const records = calculations.map(c => ({
      'Item Number': c.lineNumber || '',
      'Product Description': c.productDescription || '',
      'HTS Code': c.htsCode || '',
      'Country of Origin': c.originCountry || '',
      'Declared Value': c.declaredValue || 0,
      'Currency': c.currency || 'USD',
      'Quantity': c.quantity || 0,
      'Unit of Measure': c.unitOfMeasure || 'EA',
      'Weight (kg)': c.weight || 0,
      'Total Duty': c.results?.totalDuty || 0,
      'Total Tax': c.results?.totalTax || 0,
      'Landed Cost': c.results?.landedCost || 0,
      'Trade Agreement': c.results?.tradeAgreement || '',
    }));

    return this.generate(records, { header: true });
  }

  /**
   * Generate commercial invoice CSV
   */
  generateInvoiceExport(data: {
    invoiceNumber: string;
    seller: any;
    buyer: any;
    items: any[];
  }): Buffer {
    const records = data.items.map((item, index) => ({
      'Line Number': index + 1,
      'Product Description': item.productDescription || '',
      'HTS Code': item.htsCode || '',
      'Quantity': item.quantity || 0,
      'Unit Price': item.unitPrice || 0,
      'Total Value': item.totalValue || 0,
      'Weight': item.weight || 0,
      'Country of Origin': item.originCountry || '',
    }));

    return this.generate(records, { header: true });
  }

  /**
   * Generate packing list CSV
   */
  generatePackingListExport(data: {
    packages: any[];
  }): Buffer {
    const records = data.packages.flatMap((pkg, pkgIndex) => {
      return (pkg.items || []).map((item: any, itemIndex: number) => ({
        'Package Number': pkgIndex + 1,
        'Item Number': itemIndex + 1,
        'Product Description': item.productDescription || '',
        'HTS Code': item.htsCode || '',
        'Quantity': item.quantity || 0,
        'Weight per Unit': item.weightPerUnit || 0,
        'Total Weight': item.totalWeight || 0,
        'Package Weight': pkg.totalWeight || 0,
        'Dimensions': pkg.dimensions ? `${pkg.dimensions.length}x${pkg.dimensions.width}x${pkg.dimensions.height}` : '',
        'Country of Origin': item.originCountry || '',
      }));
    });

    return this.generate(records, { header: true });
  }

  /**
   * Helper: Build customs description
   */
  private buildCustomsDescription(classification: any): string {
    const parts = [
      classification.productDescription || '',
      classification.material ? `Material: ${classification.material}` : '',
      classification.usage ? `Use: ${classification.usage}` : '',
    ].filter(Boolean);

    return parts.join('. ');
  }

  /**
   * Helper: Get AD/CVD case number if applicable
   */
  private getAdCvdCaseNumber(calculation: any): string {
    if (calculation.results?.antidumpingDuty || calculation.results?.countervailingDuty) {
      return calculation.results?.adCvdCase || 'PENDING';
    }
    return '';
  }
}
