import { of } from 'rxjs';
import { HttpService } from '@nestjs/axios';
import { OpenAiService } from '@hts/core';
import { UrlClassifierService } from './url-classifier.service';
import { UrlType } from '../dto/classify-url.dto';

describe('UrlClassifierService', () => {
  let httpService: {
    head: jest.Mock;
    get: jest.Mock;
  };
  let openAiService: {
    response: jest.Mock;
  };
  let service: UrlClassifierService;

  beforeEach(() => {
    httpService = {
      head: jest.fn(),
      get: jest.fn(),
    };
    openAiService = {
      response: jest.fn(),
    };

    service = new UrlClassifierService(
      httpService as unknown as HttpService,
      openAiService as unknown as OpenAiService,
    );
  });

  it('detects signed image URLs using the pathname instead of the raw URL suffix', async () => {
    const result = await service.classifyUrl(
      'https://cdn.example.com/catalog/bottle.png?width=1200&sig=abc123',
    );

    expect(result).toEqual({
      type: UrlType.IMAGE,
      imageUrl: 'https://cdn.example.com/catalog/bottle.png?width=1200&sig=abc123',
    });
    expect(httpService.head).not.toHaveBeenCalled();
    expect(httpService.get).not.toHaveBeenCalled();
  });

  it('normalizes relative og:image values against the source page URL', async () => {
    const html = `<!doctype html>
      <html lang="en">
        <head>
          <title>Fixture bottle</title>
          <meta property="og:type" content="product" />
          <meta property="og:title" content="Insulated bottle" />
          <meta
            property="og:description"
            content="Reusable insulated stainless steel bottle for beverages and travel."
          />
          <meta property="og:image" content="/assets/bottle.png?variant=hero" />
        </head>
        <body>
          <main><h1>Fixture bottle</h1></main>
        </body>
      </html>`;

    httpService.head.mockReturnValue(
      of({
        headers: {
          'content-type': 'text/html; charset=utf-8',
        },
      }),
    );
    httpService.get.mockReturnValue(
      of({
        headers: {
          'content-type': 'text/html; charset=utf-8',
        },
        data: html,
      }),
    );

    const result = await service.classifyUrl('https://shop.example.com/products/fixture');

    expect(result.type).toBe(UrlType.PRODUCT);
    expect(result.imageUrl).toBe(
      'https://shop.example.com/assets/bottle.png?variant=hero',
    );
    expect(result.metadata?.extractionMethod).toBe('open-graph');
    expect(result.metadata?.usedBrowser).toBe(false);
  });

  it('falls back to a rendered browser pass for low-signal HTML pages and extracts product details with AI', async () => {
    const lowSignalHtml =
      '<!doctype html><html><head><title>Loading</title></head><body><div id="root"></div></body></html>';
    const renderedHtml = `<!doctype html>
      <html lang="en">
        <head>
          <title>Rendered Bottle</title>
        </head>
        <body>
          <article class="product-detail" data-product-id="fixture-rendered-bottle">
            <h1>Insulated Stainless Steel Water Bottle</h1>
            <p>Reusable vacuum-insulated stainless steel bottle for beverages.</p>
            <button>Add to Cart</button>
          </article>
        </body>
      </html>`;

    httpService.head.mockReturnValue(
      of({
        headers: {
          'content-type': 'text/html; charset=utf-8',
        },
      }),
    );
    httpService.get.mockReturnValue(
      of({
        headers: {
          'content-type': 'text/html; charset=utf-8',
        },
        data: lowSignalHtml,
      }),
    );
    openAiService.response.mockResolvedValue({
      output_text: JSON.stringify({
        productName: 'Insulated Stainless Steel Water Bottle',
        description:
          'Reusable vacuum-insulated stainless steel bottle for hot or cold beverages.',
        isProductPage: true,
        confidence: 0.95,
      }),
    });

    Object.defineProperty(service, 'browserEnabled', {
      value: true,
      configurable: true,
    });
    jest.spyOn(service as never, 'fetchHtmlWithPuppeteer' as never).mockResolvedValue({
      html: renderedHtml,
      method: 'puppeteer',
      renderedTitle: 'Rendered Bottle',
      renderedText:
        'Insulated Stainless Steel Water Bottle Reusable vacuum-insulated stainless steel bottle for hot or cold beverages.',
      screenshot: Buffer.from('fixture-image'),
      primaryImageUrl: 'https://shop.example.com/assets/bottle.png?rendered=1',
    } as never);

    const result = await service.classifyUrl(
      'https://shop.example.com/products/rendered-bottle',
    );

    expect(result.type).toBe(UrlType.PRODUCT);
    expect(result.imageUrl).toBe(
      'https://shop.example.com/assets/bottle.png?rendered=1',
    );
    expect(result.metadata?.usedBrowser).toBe(true);
    expect(result.metadata?.usedVision).toBe(true);
    expect(result.metadata?.extractionMethod).toBe('rendered-page-ai');
    expect(result.metadata?.productName).toBe(
      'Insulated Stainless Steel Water Bottle',
    );
    expect(result.metadata?.description).toContain('vacuum-insulated');
    expect(openAiService.response).toHaveBeenCalledTimes(1);
  });

  it('returns multiple product candidates for listing pages so callers can use batch lookup', async () => {
    const html = `<!doctype html>
      <html lang="en">
        <head>
          <title>Fixture Catalog</title>
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@graph": [
                {
                  "@type": "Product",
                  "name": "Insulated Stainless Steel Water Bottle",
                  "description": "Reusable stainless steel vacuum-insulated bottle for beverages with screw cap and powder-coated finish.",
                  "image": "/images/bottle.png",
                  "offers": { "@type": "Offer", "price": "24.99", "priceCurrency": "USD" }
                },
                {
                  "@type": "Product",
                  "name": "Ceramic Coffee Mug",
                  "description": "Glazed ceramic drinking mug with handle for hot beverages and daily tabletop use.",
                  "image": "/images/mug.png",
                  "offers": { "@type": "Offer", "price": "12.50", "priceCurrency": "USD" }
                }
              ]
            }
          </script>
        </head>
        <body>
          <main>
            <article class="product-card"><h2>Insulated Stainless Steel Water Bottle</h2></article>
            <article class="product-card"><h2>Ceramic Coffee Mug</h2></article>
          </main>
        </body>
      </html>`;

    httpService.head.mockReturnValue(
      of({
        headers: {
          'content-type': 'text/html; charset=utf-8',
        },
      }),
    );
    httpService.get.mockReturnValue(
      of({
        headers: {
          'content-type': 'text/html; charset=utf-8',
        },
        data: html,
      }),
    );

    const result = await service.classifyUrl('https://shop.example.com/catalog');

    expect(result.type).toBe(UrlType.WEBPAGE);
    expect(result.metadata?.isMultiProductPage).toBe(true);
    expect(result.metadata?.productCount).toBe(2);
    expect(result.metadata?.productCandidates).toEqual([
      expect.objectContaining({
        productName: 'Insulated Stainless Steel Water Bottle',
        price: '24.99',
        currency: 'USD',
        imageUrl: 'https://shop.example.com/images/bottle.png',
        source: 'structured-data',
      }),
      expect.objectContaining({
        productName: 'Ceramic Coffee Mug',
        price: '12.50',
        currency: 'USD',
        imageUrl: 'https://shop.example.com/images/mug.png',
        source: 'structured-data',
      }),
    ]);
  });
});
