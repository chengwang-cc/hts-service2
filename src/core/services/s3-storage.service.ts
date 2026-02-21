import { Injectable, Logger } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable } from 'stream';
import * as crypto from 'crypto';

export interface S3UploadOptions {
  bucket: string;
  key: string;
  stream: Readable;
  contentType?: string;
  metadata?: Record<string, string>;
}

export interface S3UploadResult {
  success: boolean;
  key: string;
  bucket: string;
  etag: string;
  size: number;
  sha256?: string;
}

/**
 * S3 Storage Service
 * Handles large file uploads and downloads with streaming
 * Calculates SHA-256 hashes during upload
 */
@Injectable()
export class S3StorageService {
  private readonly logger = new Logger(S3StorageService.name);
  private readonly s3Client: S3Client;
  private readonly defaultBucket: string;

  constructor() {
    // Initialize S3 client
    this.s3Client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials:
        process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
          ? {
              accessKeyId: process.env.AWS_ACCESS_KEY_ID,
              secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            }
          : undefined, // Use default credentials chain if not provided
    });

    this.defaultBucket = process.env.S3_BUCKET_NAME || 'hts-data';
    this.logger.log(
      `S3 Storage initialized (bucket: ${this.defaultBucket}, region: ${process.env.AWS_REGION || 'us-east-1'})`,
    );
  }

  /**
   * Upload stream to S3 with automatic multipart upload
   * Calculates SHA-256 hash during upload
   */
  async uploadStream(options: S3UploadOptions): Promise<S3UploadResult> {
    const { bucket, key, stream, contentType, metadata } = options;

    this.logger.log(`Uploading to S3: s3://${bucket}/${key}`);

    try {
      // Create hash calculator
      const hash = crypto.createHash('sha256');
      let totalSize = 0;

      // Create pass-through stream for hash calculation
      const passThrough = new Readable({
        read() {},
      });

      stream.on('data', (chunk) => {
        hash.update(chunk);
        totalSize += chunk.length;
        passThrough.push(chunk);
      });

      stream.on('end', () => {
        passThrough.push(null);
      });

      stream.on('error', (error) => {
        passThrough.destroy(error);
      });

      // Multipart upload (handles large files automatically)
      const upload = new Upload({
        client: this.s3Client,
        params: {
          Bucket: bucket,
          Key: key,
          Body: passThrough,
          ContentType: contentType || 'application/octet-stream',
          Metadata: metadata,
        },
        queueSize: 4, // 4 concurrent parts
        partSize: 5 * 1024 * 1024, // 5MB parts
        leavePartsOnError: false,
      });

      // Track progress
      upload.on('httpUploadProgress', (progress) => {
        if (progress.total && progress.loaded) {
          const percent = Math.round((progress.loaded / progress.total) * 100);
          if (percent % 10 === 0) {
            // Log every 10%
            this.logger.debug(
              `Upload progress: ${percent}% (${progress.loaded}/${progress.total} bytes)`,
            );
          }
        }
      });

      const result = await upload.done();
      const sha256 = hash.digest('hex');

      this.logger.log(
        `Upload completed: s3://${bucket}/${key} (${totalSize} bytes, SHA-256: ${sha256.substring(0, 12)}...)`,
      );

      return {
        success: true,
        key,
        bucket,
        etag: result.ETag || '',
        size: totalSize,
        sha256,
      };
    } catch (error) {
      this.logger.error(
        `S3 upload failed for ${key}: ${error.message}`,
        error.stack,
      );
      throw new Error(`Failed to upload to S3: ${error.message}`);
    }
  }

  /**
   * Download stream from S3
   */
  async downloadStream(bucket: string, key: string): Promise<Readable> {
    this.logger.log(`Downloading from S3: s3://${bucket}/${key}`);

    try {
      const response = await this.s3Client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
        }),
      );

      return response.Body as Readable;
    } catch (error) {
      this.logger.error(`S3 download failed for ${key}: ${error.message}`);
      throw new Error(`Failed to download from S3: ${error.message}`);
    }
  }

  /**
   * Check if object exists in S3
   */
  async exists(bucket: string, key: string): Promise<boolean> {
    try {
      await this.s3Client.send(
        new HeadObjectCommand({
          Bucket: bucket,
          Key: key,
        }),
      );
      return true;
    } catch (error) {
      if (error.name === 'NotFound' || error.name === 'NoSuchKey') {
        return false;
      }
      throw error;
    }
  }

  /**
   * Get object metadata
   */
  async getMetadata(
    bucket: string,
    key: string,
  ): Promise<{
    size: number;
    etag: string;
    lastModified: Date;
    contentType: string;
    metadata: Record<string, string>;
  }> {
    const response = await this.s3Client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
    );

    return {
      size: response.ContentLength || 0,
      etag: response.ETag || '',
      lastModified: response.LastModified || new Date(),
      contentType: response.ContentType || 'application/octet-stream',
      metadata: response.Metadata || {},
    };
  }

  /**
   * Get default bucket name
   */
  getDefaultBucket(): string {
    return this.defaultBucket;
  }
}
