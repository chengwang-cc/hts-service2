import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import * as crypto from 'crypto';
import {
  IUsitcDownloaderService,
  UsitcDownloadResult,
} from '../interfaces/usitc-downloader.interface';

/**
 * USITC Downloader Service
 * Downloads HTS data from USITC website
 */
@Injectable()
export class UsitcDownloaderService implements IUsitcDownloaderService {
  private readonly logger = new Logger(UsitcDownloaderService.name);
  private readonly baseUrl =
    'https://www.usitc.gov/sites/default/files/tata/hts';
  private readonly axios: AxiosInstance;

  constructor() {
    this.axios = axios.create({
      timeout: 60000, // 60 seconds
      maxContentLength: 100 * 1024 * 1024, // 100MB
      maxBodyLength: 100 * 1024 * 1024,
    });

    this.logger.log('USITC Downloader service initialized');
  }

  /**
   * Download HTS data for a specific year and revision
   */
  async downloadHtsData(
    year: number,
    revision: number,
  ): Promise<UsitcDownloadResult> {
    const version = `${year}_revision_${revision}`;
    const url = this.getDownloadUrl(year, revision);

    this.logger.log(`Downloading HTS data: ${version} from ${url}`);

    try {
      const response = await this.axios.get(url, {
        responseType: 'json',
      });

      if (response.status !== 200) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = response.data;

      // Calculate file hash
      const jsonString = JSON.stringify(data);
      const fileHash = crypto
        .createHash('sha256')
        .update(jsonString)
        .digest('hex');

      this.logger.log(
        `Successfully downloaded ${version}, hash: ${fileHash.substring(0, 12)}...`,
      );

      return {
        success: true,
        version,
        url,
        data,
        fileHash,
      };
    } catch (error) {
      this.logger.error(`Failed to download ${version}: ${error.message}`);

      return {
        success: false,
        version,
        url,
        error: error.message,
      };
    }
  }

  /**
   * Find latest available HTS revision.
   *
   * P1.4 — the old implementation looped `for (revision = 10; revision >= 1; --)`
   * which silently drops anything past revision 10. Newer USITC years already
   * publish double-digit revisions (e.g. 2026 has 8 listed as of 2026-05; 2027
   * is expected to go past 10). We now:
   *   1. Fetch the USITC archive listing page and parse `(year, revision, date)`
   *      tuples for the latest entry. Cached for 1 hour to be a polite client.
   *   2. Fall back to URL probing scanning revisions 1..20 (was 1..10).
   */
  private archiveCache: {
    fetchedAt: number;
    latest: { year: number; revision: number; releaseDate?: string } | null;
  } | null = null;
  private readonly archiveCacheTtlMs = 60 * 60 * 1000;
  private readonly archiveListUrl =
    'https://www.usitc.gov/harmonized_tariff_information/hts/archive/list';

  async findLatestRevision(): Promise<{
    year: number;
    revision: number;
    jsonUrl: string;
    pdfUrl: string;
  } | null> {
    // Step 1: try the archive listing page.
    const fromArchive = await this.findLatestFromArchive();
    if (fromArchive) {
      this.logger.log(
        `Found latest from USITC archive: ${fromArchive.year} revision ${fromArchive.revision}`,
      );
      return {
        year: fromArchive.year,
        revision: fromArchive.revision,
        jsonUrl: this.getDownloadUrl(fromArchive.year, fromArchive.revision),
        pdfUrl: this.getPdfDownloadUrl(fromArchive.year, fromArchive.revision),
      };
    }

    // Step 2: probe revisions 1..20 in current then previous year as a
    // safety net. This is the old code path widened from 10 to 20.
    const currentYear = new Date().getFullYear();
    for (const year of [currentYear, currentYear - 1]) {
      for (let revision = 20; revision >= 1; revision--) {
        const url = this.getDownloadUrl(year, revision);
        if (await this.checkUrlExists(url)) {
          this.logger.log(
            `Found latest via URL probe: ${year} revision ${revision}`,
          );
          return {
            year,
            revision,
            jsonUrl: this.getDownloadUrl(year, revision),
            pdfUrl: this.getPdfDownloadUrl(year, revision),
          };
        }
      }
    }

    return null;
  }

  private async findLatestFromArchive(): Promise<{
    year: number;
    revision: number;
    releaseDate?: string;
  } | null> {
    if (
      this.archiveCache &&
      Date.now() - this.archiveCache.fetchedAt < this.archiveCacheTtlMs
    ) {
      return this.archiveCache.latest;
    }

    try {
      const response = await this.axios.get<string>(this.archiveListUrl, {
        responseType: 'text',
        // The archive page is HTML; ensure axios doesn't try to JSON-parse it.
        transformResponse: [(data: any) => data],
        headers: { Accept: 'text/html,application/xhtml+xml' },
      });
      if (response.status !== 200 || typeof response.data !== 'string') {
        this.archiveCache = { fetchedAt: Date.now(), latest: null };
        return null;
      }
      const latest = this.parseArchiveListing(response.data);
      this.archiveCache = { fetchedAt: Date.now(), latest };
      return latest;
    } catch (e: any) {
      this.logger.warn(
        `USITC archive listing fetch failed (${e?.message}); falling back to URL probe`,
      );
      this.archiveCache = { fetchedAt: Date.now(), latest: null };
      return null;
    }
  }

  /**
   * Parses entries of the form `2026 HTS Revision 8 (May 22, 2026)` out of
   * the USITC archive listing HTML. Picks the largest (year, revision) tuple.
   */
  parseArchiveListing(html: string): {
    year: number;
    revision: number;
    releaseDate?: string;
  } | null {
    const re =
      /(\d{4})\s+HTS\s+Revision\s+(\d{1,3})\s*(?:\(([^)]+)\))?/gi;
    let m: RegExpExecArray | null;
    let best: { year: number; revision: number; releaseDate?: string } | null =
      null;
    while ((m = re.exec(html)) !== null) {
      const year = Number(m[1]);
      const revision = Number(m[2]);
      if (!Number.isFinite(year) || !Number.isFinite(revision)) continue;
      const candidate = { year, revision, releaseDate: m[3]?.trim() };
      if (
        !best ||
        year > best.year ||
        (year === best.year && revision > best.revision)
      ) {
        best = candidate;
      }
    }
    return best;
  }

  /**
   * Download latest HTS data (automatically finds latest revision)
   */
  async downloadLatest(): Promise<UsitcDownloadResult> {
    this.logger.log('Finding latest available HTS revision...');

    const latest = await this.findLatestRevision();

    if (!latest) {
      return {
        success: false,
        version: 'unknown',
        url: '',
        error: 'Could not find any available HTS data',
      };
    }

    this.logger.log(
      `Downloading latest: ${latest.year} revision ${latest.revision}`,
    );

    return await this.downloadHtsData(latest.year, latest.revision);
  }

  /**
   * Check if newer version is available
   */
  async checkForUpdates(currentVersion: string): Promise<{
    hasUpdate: boolean;
    latestVersion?: string;
    url?: string;
  }> {
    try {
      // Parse current version
      const match = currentVersion.match(/(\d{4})_revision_(\d+)/);
      if (!match) {
        throw new Error('Invalid version format');
      }

      const currentYear = parseInt(match[1], 10);
      const currentRevision = parseInt(match[2], 10);

      // Check for newer revision in same year
      const nextRevisionUrl = this.getDownloadUrl(
        currentYear,
        currentRevision + 1,
      );
      const nextRevisionExists = await this.checkUrlExists(nextRevisionUrl);

      if (nextRevisionExists) {
        const latestVersion = `${currentYear}_revision_${currentRevision + 1}`;
        return {
          hasUpdate: true,
          latestVersion,
          url: nextRevisionUrl,
        };
      }

      // Check for new year
      const nextYear = currentYear + 1;
      const nextYearUrl = this.getDownloadUrl(nextYear, 1);
      const nextYearExists = await this.checkUrlExists(nextYearUrl);

      if (nextYearExists) {
        const latestVersion = `${nextYear}_revision_1`;
        return {
          hasUpdate: true,
          latestVersion,
          url: nextYearUrl,
        };
      }

      // No updates found
      return {
        hasUpdate: false,
      };
    } catch (error) {
      this.logger.error(`Error checking for updates: ${error.message}`);
      return {
        hasUpdate: false,
      };
    }
  }

  /**
   * Get JSON download URL for specific version
   */
  getDownloadUrl(year: number, revision: number): string {
    return `${this.baseUrl}/hts_${year}_revision_${revision}_json.json`;
  }

  /**
   * Get PDF download URL for specific version
   */
  getPdfDownloadUrl(year: number, revision: number): string {
    const release = `${year}HTSRev${revision}`;
    return `https://hts.usitc.gov/reststop/file?release=${release}&filename=finalCopy`;
  }

  /**
   * Check if URL exists (HEAD request)
   */
  private async checkUrlExists(url: string): Promise<boolean> {
    try {
      const response = await this.axios.head(url, {
        timeout: 10000,
      });
      return response.status === 200;
    } catch (error) {
      return false;
    }
  }

  /**
   * Download with retry logic
   */
  async downloadWithRetry(
    year: number,
    revision: number,
    maxRetries: number = 3,
  ): Promise<UsitcDownloadResult> {
    let lastError: string = '';

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      this.logger.log(
        `Download attempt ${attempt}/${maxRetries} for ${year}_revision_${revision}`,
      );

      const result = await this.downloadHtsData(year, revision);

      if (result.success) {
        return result;
      }

      lastError = result.error || 'Unknown error';

      // Wait before retry (exponential backoff)
      if (attempt < maxRetries) {
        const waitTime = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
        this.logger.log(`Waiting ${waitTime}ms before retry...`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }

    return {
      success: false,
      version: `${year}_revision_${revision}`,
      url: this.getDownloadUrl(year, revision),
      error: `Failed after ${maxRetries} attempts. Last error: ${lastError}`,
    };
  }
}
