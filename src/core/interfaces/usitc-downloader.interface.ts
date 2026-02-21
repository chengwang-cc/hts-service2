/**
 * USITC Download Result
 */
export interface UsitcDownloadResult {
  success: boolean;
  version: string;
  url: string;
  data?: any;
  fileHash?: string;
  error?: string;
}

/**
 * USITC Downloader Service Interface
 */
export interface IUsitcDownloaderService {
  /**
   * Download HTS data for a specific year and revision
   */
  downloadHtsData(year: number, revision: number): Promise<UsitcDownloadResult>;

  /**
   * Download latest HTS data
   */
  downloadLatest(): Promise<UsitcDownloadResult>;

  /**
   * Check if newer version is available
   */
  checkForUpdates(currentVersion: string): Promise<{
    hasUpdate: boolean;
    latestVersion?: string;
    url?: string;
  }>;

  /**
   * Get download URL for specific version
   */
  getDownloadUrl(year: number, revision: number): string;
}
