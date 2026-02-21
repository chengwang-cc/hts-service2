import { Controller, Get, Param, Post, HttpCode } from '@nestjs/common';
import { RateLimitService } from '@hts/lookup';

/**
 * Test Controller - Provides mock product pages and utilities for E2E testing
 * These endpoints return HTML that can be scraped by the URL classifier
 */
@Controller('test')
export class TestController {
  constructor(private readonly rateLimitService: RateLimitService) {}
  /**
   * Serves a mock product page HTML
   * Used for E2E tests to avoid external site blocking
   */
  @Get('product/:id')
  getProductPage(@Param('id') id: string) {
    const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Test Product ${id} - E2E Test Store</title>
  <meta property="og:title" content="Test Product ${id}">
  <meta property="og:description" content="This is a test product for E2E testing. Product ID: ${id}">
  <meta property="og:type" content="product">
  <meta property="og:price:amount" content="29.99">
  <meta property="og:price:currency" content="USD">
  <meta property="og:image" content="https://example.com/test-product-${id}.jpg">
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": "Test Product ${id}",
    "description": "A test product for automated E2E testing",
    "image": "https://example.com/test-product-${id}.jpg",
    "offers": {
      "@type": "Offer",
      "price": "29.99",
      "priceCurrency": "USD"
    }
  }
  </script>
</head>
<body>
  <h1>Test Product ${id}</h1>
  <div class="product-description">
    <p>This is a test product for E2E testing.</p>
    <p>Product ID: ${id}</p>
  </div>
  <div class="price">$29.99</div>
  <button>Add to Cart</button>
</body>
</html>
`;

    // Return HTML with proper content type
    return html;
  }

  /**
   * Health check endpoint for tests
   */
  @Get('health')
  health() {
    return { status: 'ok', service: 'test' };
  }

  /**
   * Reset rate limits for testing (only available in development)
   * DELETE /api/v1/test/rate-limits
   */
  @Post('rate-limits/reset')
  @HttpCode(200)
  async resetRateLimits() {
    if (process.env.NODE_ENV !== 'development') {
      return { error: 'Only available in development mode' };
    }

    // This would require direct database access to delete rate limit records
    // For now, return a placeholder response
    return {
      message: 'Rate limits reset (manual database cleanup required)',
      note: 'For testing, consider using authenticated users or increasing limits',
    };
  }
}
