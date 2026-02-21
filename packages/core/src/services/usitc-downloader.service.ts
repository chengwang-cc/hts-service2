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
   * Find latest available HTS revision
   * Checks current year first (rev 10 -> 1), then previous year
   */
  async findLatestRevision(): Promise<{
    year: number;
    revision: number;
    jsonUrl: string;
    pdfUrl: string;
  } | null> {
    const currentYear = new Date().getFullYear();

    // Try current year (check from high to low)
    for (let revision = 10; revision >= 1; revision--) {
      const url = this.getDownloadUrl(currentYear, revision);
      if (await this.checkUrlExists(url)) {
        this.logger.log(`Found latest: ${currentYear} revision ${revision}`);
        return {
          year: currentYear,
          revision,
          jsonUrl: this.getDownloadUrl(currentYear, revision),
          pdfUrl: this.getPdfDownloadUrl(currentYear, revision),
        };
      }
    }

    // Try previous year
    const previousYear = currentYear - 1;
    for (let revision = 10; revision >= 1; revision--) {
      const url = this.getDownloadUrl(previousYear, revision);
      if (await this.checkUrlExists(url)) {
        this.logger.log(`Found latest: ${previousYear} revision ${revision}`);
        return {
          year: previousYear,
          revision,
          jsonUrl: this.getDownloadUrl(previousYear, revision),
          pdfUrl: this.getPdfDownloadUrl(previousYear, revision),
        };
      }
    }

    return null;
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
