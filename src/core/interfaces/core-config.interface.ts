/**
 * OpenAI Configuration
 */
export interface OpenAiConfig {
  apiKey: string;
  model?: string;
  embeddingModel?: string;
}

/**
 * Database Configuration
 */
export interface DatabaseConfig {
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  database?: string;
}

/**
 * Queue Configuration (pg-boss)
 */
export interface QueueConfig {
  enabled?: boolean;
  retryLimit?: number;
  retryDelay?: number;
  expireInHours?: number;
}

/**
 * USITC Configuration
 */
export interface UsitcConfig {
  baseUrl?: string;
  defaultYear?: number;
  defaultRevision?: number;
}

/**
 * Core Module Configuration Options
 */
export interface CoreModuleOptions {
  /**
   * OpenAI API configuration
   */
  openai: OpenAiConfig;

  /**
   * Database configuration (optional - falls back to env vars)
   */
  database?: DatabaseConfig;

  /**
   * Queue configuration (optional)
   */
  queue?: QueueConfig;

  /**
   * USITC configuration (optional)
   */
  usitc?: UsitcConfig;

  /**
   * Global settings
   */
  global?: {
    logLevel?: 'error' | 'warn' | 'log' | 'debug' | 'verbose';
  };
}
