import { HtsEntity } from '../entities/hts.entity';

/**
 * USITC HTS Item (raw data structure from JSON)
 */
export interface UsitcHtsItem {
  htsno?: string;
  indent?: number;
  description?: string;
  unit?: string;
  general?: string;
  special?: string;
  '2'?: string; // Column 2 (Other/Non-NTR rate)
  footnotes?: string;
  [key: string]: any;
}

/**
 * Processing Result
 */
export interface ProcessingResult {
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: Array<{ htsNumber: string; error: string }>;
}

/**
 * HTS Processor Service Interface
 */
export interface IHtsProcessorService {
  /**
   * Process entire USITC dataset
   */
  processUsitcData(
    data: any,
    version: string,
  ): Promise<ProcessingResult>;

  /**
   * Process single HTS item from USITC JSON
   */
  processHtsItem(
    item: UsitcHtsItem,
    version: string,
    chapter: string,
  ): Partial<HtsEntity> | null;

  /**
   * Parse special rates (country-specific rates)
   */
  parseSpecialRates(specialRateText: string): Record<string, string> | null;

  /**
   * Extract HTS codes from footnotes (Chapter 99 references)
   */
  extractHtsCodesFromFootnotes(footnotes: string): string[];

  /**
   * Build hierarchy (determine parent HTS number)
   */
  buildHierarchy(
    htsNumber: string,
    indent: number,
    previousEntries: Map<number, string>,
  ): {
    parentHtsNumber: string | null;
    isHeading: boolean;
    isSubheading: boolean;
  };
}
