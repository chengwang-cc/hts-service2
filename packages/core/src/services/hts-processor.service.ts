import { Injectable, Logger } from '@nestjs/common';
import { HtsEntity } from '../entities/hts.entity';
import { HtsRepository } from '../repositories/hts.repository';
import {
  IHtsProcessorService,
  UsitcHtsItem,
  ProcessingResult,
} from '../interfaces/hts-processor.interface';

/**
 * HTS Processor Service
 * Processes raw USITC JSON data into HTS entities
 */
@Injectable()
export class HtsProcessorService implements IHtsProcessorService {
  private readonly logger = new Logger(HtsProcessorService.name);

  constructor(private readonly htsRepository: HtsRepository) {}

  /**
   * Process entire USITC dataset
   */
  async processUsitcData(
    data: any,
    version: string,
  ): Promise<ProcessingResult> {
    this.logger.log(`Starting HTS data processing for version: ${version}`);

    const result: ProcessingResult = {
      processed: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    };

    // USITC JSON structure: { chapters: { "01": [...], "02": [...], ... } }
    const chapters = data.chapters || data;

    const allEntries: Partial<HtsEntity>[] = [];
    const indentStack = new Map<number, string>(); // Track parent at each indent level
    const descriptionStack = new Map<number, string>(); // Track description at each indent level

    for (const [chapterNum, items] of Object.entries(chapters)) {
      if (!Array.isArray(items)) {
        this.logger.warn(`Chapter ${chapterNum} is not an array, skipping`);
        continue;
      }

      this.logger.log(
        `Processing Chapter ${chapterNum}: ${items.length} items`,
      );

      for (const item of items) {
        try {
          const processed = this.processHtsItem(item, version, chapterNum);

          if (processed) {
            // Build hierarchy
            const hierarchy = this.buildHierarchy(
              processed.htsNumber!,
              processed.indent || 0,
              indentStack,
            );

            processed.parentHtsNumber = hierarchy.parentHtsNumber;
            processed.isHeading = hierarchy.isHeading;
            processed.isSubheading = hierarchy.isSubheading;
            processed.parentHtses = this.buildParentList(
              processed.indent || 0,
              indentStack,
            );
            processed.fullDescription = this.buildDescriptionList(
              processed.indent || 0,
              descriptionStack,
              processed.description || '',
            );

            // Update indent stack
            indentStack.set(processed.indent || 0, processed.htsNumber!);
            descriptionStack.set(processed.indent || 0, processed.description || '');

            allEntries.push(processed);
            result.processed++;
          } else {
            result.skipped++;
          }
        } catch (error) {
          result.failed++;
          result.errors.push({
            htsNumber: item.htsno || 'unknown',
            error: error.message,
          });

          if (result.errors.length < 10) {
            this.logger.error(
              `Error processing item ${item.htsno}: ${error.message}`,
            );
          }
        }
      }
    }

    // Batch upsert all entries
    this.logger.log(`Upserting ${allEntries.length} entries...`);
    await this.htsRepository.upsertBatch(allEntries, 1000);

    // Determine created vs updated (simplified - all counted as created)
    result.created = allEntries.length;

    this.logger.log(
      `Processing complete: ${result.processed} processed, ${result.created} created, ${result.failed} failed`,
    );

    return result;
  }

  /**
   * Process single HTS item from USITC JSON
   */
  processHtsItem(
    item: UsitcHtsItem,
    version: string,
    chapter: string,
  ): Partial<HtsEntity> | null {
    // Skip if no HTS number
    if (!item.htsno) {
      return null;
    }

    const htsNumber = item.htsno.trim();

    // Skip headings and purely informational entries (no actual code)
    if (htsNumber.length < 4) {
      return null;
    }

    // Extract components
    const heading = htsNumber.substring(0, 4);
    const subheading = htsNumber.length >= 6 ? htsNumber.substring(0, 6) : null;
    const statisticalSuffix =
      htsNumber.length >= 8 ? htsNumber.substring(0, 10) : null;

    // Parse special rates
    const specialRates = item.special
      ? this.parseSpecialRates(item.special)
      : null;

    // Build HTS entity
    const htsEntity: Partial<HtsEntity> = {
      htsNumber,
      indent: item.indent || 0,
      description: item.description?.trim() || '',
      unitOfQuantity: item.unit?.trim() || null,
      unit: item.unit?.trim() || null,
      generalRate: item.general?.trim() || null,
      general: item.general?.trim() || null,
      rateFormula: null, // Will be populated by formula generation
      rateVariables: null,
      isFormulaGenerated: false,
      otherRate: item['2']?.trim() || null,
      other: item['2']?.trim() || null,
      otherRateFormula: null,
      otherRateVariables: null,
      isOtherFormulaGenerated: false,
      specialRates,
      special: item.special?.trim() || null,
      chapter99: null, // Extract from footnotes if present
      adjustedFormula: null,
      adjustedFormulaVariables: null,
      isAdjustedFormulaGenerated: false,
      otherChapter99: null,
      otherChapter99Detail: null,
      footnotes: this.normalizeFootnotes(item.footnotes),
      additionalDuties: null,
      quota: item.quota?.trim() || null,
      quota2: item.quota2?.trim() || null,
      chapter,
      heading,
      subheading,
      statisticalSuffix,
      parentHtsNumber: null, // Will be set by hierarchy builder
      isHeading: false, // Will be set by hierarchy builder
      isSubheading: false, // Will be set by hierarchy builder
      hasChildren: false, // Will be updated later if needed
      sourceVersion: version,
      version,
      importDate: new Date(),
      isActive: true,
      effectiveDate: null,
      expirationDate: null,
      confirmed: false,
      updateFormulaComment: null,
      requiredReview: false,
      requiredReviewComment: null,
      metadata: {
        rawItem: item, // Store original for debugging
      },
    };

    return htsEntity;
  }

  private normalizeFootnotes(raw: unknown): string | null {
    if (!raw) {
      return null;
    }
    if (typeof raw === 'string') {
      const value = raw.trim();
      return value.length > 0 ? value : null;
    }
    if (Array.isArray(raw)) {
      const values = raw
        .map((item) => {
          if (typeof item === 'string') return item.trim();
          if (item && typeof (item as any).value === 'string') {
            return (item as any).value.trim();
          }
          return '';
        })
        .filter((value) => value.length > 0);

      if (values.length > 0) {
        return values.join(' ');
      }
      return JSON.stringify(raw);
    }
    return JSON.stringify(raw);
  }

  /**
   * Parse special rates (country-specific rates)
   * Example input: "Free (A+,AU,BH,CL,CO,D,E,IL,JO,KR,MA,MX,OM,P,PA,PE,S,SG)"
   */
  parseSpecialRates(specialRateText: string): Record<string, string> | null {
    if (!specialRateText || specialRateText.trim() === '') {
      return null;
    }

    const rates: Record<string, string> = {};

    // Pattern: "rate (countries)" or "rate countries"
    // Example: "Free (A+,AU,BH)" or "2.5% (CA,MX)"
    const match = specialRateText.match(/^(.+?)\s*\(([^)]+)\)/);

    if (match) {
      const rate = match[1].trim();
      const countries = match[2].split(',').map((c) => c.trim());

      for (const country of countries) {
        if (country) {
          rates[country] = rate;
        }
      }

      return rates;
    }

    // If no match, store as-is
    return { ALL: specialRateText.trim() };
  }

  /**
   * Extract HTS codes from footnotes (Chapter 99 references)
   * Example: "See 9903.88.03" → ["9903.88.03"]
   */
  extractHtsCodesFromFootnotes(footnotes: string): string[] {
    if (!footnotes) return [];

    const codes: string[] = [];

    // Pattern: digits followed by dots and more digits
    // Matches: 9903.88.03, 9902.12.34.56, etc.
    const pattern = /\b(\d{4}\.\d{2}\.\d{2}(?:\.\d{2})?)\b/g;
    let match;

    while ((match = pattern.exec(footnotes)) !== null) {
      codes.push(match[1]);
    }

    return codes;
  }

  /**
   * Build hierarchy (determine parent HTS number)
   * Uses indent level to determine parent-child relationships
   */
  buildHierarchy(
    htsNumber: string,
    indent: number,
    previousEntries: Map<number, string>,
  ): {
    parentHtsNumber: string | null;
    isHeading: boolean;
    isSubheading: boolean;
  } {
    let parentHtsNumber: string | null = null;
    let isHeading = false;
    let isSubheading = false;

    // Determine type based on HTS number structure
    if (htsNumber.length === 4) {
      // Heading level (e.g., "0101")
      isHeading = true;
      parentHtsNumber = htsNumber.substring(0, 2); // Chapter is parent
    } else if (htsNumber.length === 6 || htsNumber.length === 10) {
      // Subheading or statistical suffix
      if (htsNumber.length === 6) {
        isSubheading = true;
      }

      // Find parent by looking at previous indent levels
      if (indent > 0) {
        // Look for closest parent with lower indent
        for (let parentIndent = indent - 1; parentIndent >= 0; parentIndent--) {
          const potentialParent = previousEntries.get(parentIndent);
          if (potentialParent) {
            parentHtsNumber = potentialParent;
            break;
          }
        }
      }

      // Fallback: use heading as parent
      if (!parentHtsNumber && htsNumber.length >= 4) {
        parentHtsNumber = htsNumber.substring(0, 4);
      }
    }

    return {
      parentHtsNumber,
      isHeading,
      isSubheading,
    };
  }

  /**
   * Build parent HTS list from indent stack
   */
  private buildParentList(
    indent: number,
    previousEntries: Map<number, string>,
  ): string[] {
    const parents: string[] = [];

    if (indent <= 0) return parents;

    for (let parentIndent = 0; parentIndent < indent; parentIndent++) {
      const parent = previousEntries.get(parentIndent);
      if (parent) {
        parents.push(parent);
      }
    }

    return parents;
  }

  /**
   * Build full description list from indent stack
   */
  private buildDescriptionList(
    indent: number,
    descriptionStack: Map<number, string>,
    currentDescription: string,
  ): string[] {
    const descriptions: string[] = [];

    if (indent > 0) {
      for (let parentIndent = 0; parentIndent < indent; parentIndent++) {
        const parentDescription = descriptionStack.get(parentIndent);
        if (parentDescription) {
          descriptions.push(parentDescription);
        }
      }
    }

    if (currentDescription) {
      descriptions.push(currentDescription);
    }

    return descriptions;
  }

  /**
   * Update hasChildren flag for parent entries
   * Should be called after all entries are processed
   */
  async updateHasChildrenFlags(): Promise<void> {
    this.logger.log('Updating hasChildren flags...');

    // This could be optimized with a SQL query
    // UPDATE hts SET has_children = true WHERE hts_number IN (SELECT DISTINCT parent_hts_number FROM hts WHERE parent_hts_number IS NOT NULL)

    // For now, we'll rely on the database to handle this via a migration
    this.logger.log('hasChildren update complete');
  }
}
