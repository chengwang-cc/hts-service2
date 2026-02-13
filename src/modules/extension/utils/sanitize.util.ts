/**
 * Sanitization utilities for preventing XSS and injection attacks
 */

/**
 * Strip all HTML tags from a string
 * Prevents XSS by removing any HTML/JavaScript
 */
export function stripHtml(input: string): string {
  if (!input) return '';

  return input
    .replace(/<[^>]*>/g, '') // Remove all HTML tags
    .replace(/&lt;/g, '<') // Decode HTML entities
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

/**
 * Sanitize user feedback text
 * Removes HTML and limits length
 */
export function sanitizeFeedbackText(text: string, maxLength = 5000): string {
  if (!text) return '';

  const sanitized = stripHtml(text);
  return sanitized.substring(0, maxLength);
}

/**
 * Sanitize product data from untrusted sources
 * Used for LLM detection inputs
 */
export function sanitizeProductText(text: string, maxLength = 2000): string {
  if (!text) return '';

  const sanitized = stripHtml(text);
  return sanitized.substring(0, maxLength);
}

/**
 * Validate and sanitize HTS code format
 * Ensures HTS code matches expected pattern
 */
export function sanitizeHtsCode(code: string): string | null {
  if (!code) return null;

  // Remove any non-digit or non-dot characters
  const cleaned = code.replace(/[^\d.]/g, '');

  // HTS codes should be 10 digits with dots (e.g., 0101.21.0000)
  const htsPattern = /^\d{4}\.\d{2}\.\d{4}$/;

  if (htsPattern.test(cleaned)) {
    return cleaned;
  }

  // Also accept format without dots (e.g., 0101210000)
  if (/^\d{10}$/.test(cleaned)) {
    // Format: XXXX.XX.XXXX
    return `${cleaned.slice(0, 4)}.${cleaned.slice(4, 6)}.${cleaned.slice(6, 10)}`;
  }

  return null;
}

/**
 * Sanitize URL to remove potentially malicious content
 * Validates URL format and removes dangerous protocols
 */
export function sanitizeUrl(url: string): string | null {
  if (!url) return null;

  try {
    const urlObj = new URL(url);

    // Only allow http and https protocols
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      return null;
    }

    // Remove dangerous query parameters
    const dangerousParams = ['javascript:', 'data:', 'vbscript:', 'file:'];
    urlObj.searchParams.forEach((value, key) => {
      if (dangerousParams.some((dangerous) => value.includes(dangerous))) {
        urlObj.searchParams.delete(key);
      }
    });

    return urlObj.toString();
  } catch {
    // Invalid URL
    return null;
  }
}
