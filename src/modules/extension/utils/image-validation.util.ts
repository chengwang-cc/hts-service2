import { BadRequestException } from '@nestjs/common';
import * as crypto from 'crypto';
import imageSize from 'image-size';

export interface ImageValidationResult {
  isValid: boolean;
  hash: string;
  width: number;
  height: number;
  format: string;
  sizeBytes: number;
}

/**
 * Validate uploaded image file for security
 * Checks MIME type, file size, dimensions, and format
 */
export async function validateImageFile(
  file: Express.Multer.File,
): Promise<ImageValidationResult> {
  // 1. Size check (max 10MB)
  const MAX_SIZE = 10 * 1024 * 1024; // 10MB
  if (file.size > MAX_SIZE) {
    throw new BadRequestException(
      `Image too large (${Math.round(file.size / 1024 / 1024)}MB). Maximum size is 10MB.`,
    );
  }

  // 2. MIME type check
  const allowedMimeTypes = [
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
  ];

  if (!allowedMimeTypes.includes(file.mimetype)) {
    throw new BadRequestException(
      `Invalid image format. Allowed formats: PNG, JPG, JPEG, WebP. Received: ${file.mimetype}`,
    );
  }

  // 3. Validate actual image content (not just MIME type)
  // This prevents attacks where file extension/MIME is spoofed
  let dimensions;
  try {
    dimensions = imageSize(file.buffer);
  } catch (error) {
    throw new BadRequestException(
      'Invalid or corrupted image file. Unable to read image data.',
    );
  }

  if (!dimensions.width || !dimensions.height) {
    throw new BadRequestException('Unable to determine image dimensions.');
  }

  // 4. Dimension check (max 4096x4096 to prevent DoS)
  const MAX_DIMENSION = 4096;
  if (dimensions.width > MAX_DIMENSION || dimensions.height > MAX_DIMENSION) {
    throw new BadRequestException(
      `Image dimensions too large (${dimensions.width}x${dimensions.height}). Maximum is ${MAX_DIMENSION}x${MAX_DIMENSION}.`,
    );
  }

  // 5. Minimum dimension check (avoid tiny images that are likely invalid)
  const MIN_DIMENSION = 50;
  if (dimensions.width < MIN_DIMENSION || dimensions.height < MIN_DIMENSION) {
    throw new BadRequestException(
      `Image dimensions too small (${dimensions.width}x${dimensions.height}). Minimum is ${MIN_DIMENSION}x${MIN_DIMENSION}.`,
    );
  }

  // 6. Calculate hash for deduplication
  const hash = crypto.createHash('sha256').update(file.buffer).digest('hex');

  // 7. Validate format matches MIME type
  const mimeToFormat: Record<string, string[]> = {
    'image/png': ['png'],
    'image/jpeg': ['jpg', 'jpeg'],
    'image/jpg': ['jpg', 'jpeg'],
    'image/webp': ['webp'],
  };

  const expectedFormats = mimeToFormat[file.mimetype] || [];
  const actualFormat = dimensions.type?.toLowerCase() || '';

  if (!expectedFormats.includes(actualFormat)) {
    throw new BadRequestException(
      `MIME type mismatch. File claims to be ${file.mimetype} but appears to be ${actualFormat}.`,
    );
  }

  return {
    isValid: true,
    hash,
    width: dimensions.width,
    height: dimensions.height,
    format: actualFormat,
    sizeBytes: file.size,
  };
}

/**
 * Validate image URL for security (SSRF prevention)
 */
export function validateImageUrl(url: string): void {
  try {
    const urlObj = new URL(url);

    // Only allow HTTP/HTTPS protocols
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      throw new BadRequestException(
        `Invalid protocol. Only HTTP and HTTPS are allowed.`,
      );
    }

    // Block internal/private network URLs (SSRF prevention)
    const hostname = urlObj.hostname.toLowerCase();

    const blockedPatterns = [
      'localhost',
      '127.0.0.1',
      '0.0.0.0',
      '::1',
      '10.', // Private IP range
      '172.16.', // Private IP range
      '172.17.', // Private IP range
      '172.18.', // Private IP range
      '172.19.', // Private IP range
      '172.20.', // Private IP range
      '172.21.', // Private IP range
      '172.22.', // Private IP range
      '172.23.', // Private IP range
      '172.24.', // Private IP range
      '172.25.', // Private IP range
      '172.26.', // Private IP range
      '172.27.', // Private IP range
      '172.28.', // Private IP range
      '172.29.', // Private IP range
      '172.30.', // Private IP range
      '172.31.', // Private IP range
      '192.168.', // Private IP range
      'metadata.google.internal', // Cloud metadata
      '169.254.', // Link-local
    ];

    for (const pattern of blockedPatterns) {
      if (hostname.includes(pattern)) {
        throw new BadRequestException(
          'Access to internal/private network URLs is not allowed.',
        );
      }
    }
  } catch (error) {
    if (error instanceof BadRequestException) {
      throw error;
    }
    throw new BadRequestException(`Invalid URL: ${error.message}`);
  }
}

/**
 * Get image format from buffer by checking magic numbers
 * More secure than relying on file extension or MIME type
 */
export function getImageFormatFromBuffer(buffer: Buffer): string | null {
  // Check magic numbers (first few bytes of file)
  if (buffer.length < 4) {
    return null;
  }

  // PNG: 89 50 4E 47
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'png';
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg';
  }

  // WebP: RIFF ... WEBP
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46
  ) {
    if (buffer.length >= 12) {
      const webpSignature =
        buffer[8] === 0x57 &&
        buffer[9] === 0x45 &&
        buffer[10] === 0x42 &&
        buffer[11] === 0x50;
      if (webpSignature) {
        return 'webp';
      }
    }
  }

  return null;
}
