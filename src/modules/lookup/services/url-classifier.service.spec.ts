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
    expect(result.imageUrl).toBeUndefined();
    expect(result.metadata?.previewImageUrl).toBe(
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
    expect(result.imageUrl).toBeUndefined();
    expect(result.metadata?.previewImageUrl).toBe(
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

  it('prefers Puppeteer first for Amazon-style product detail URLs', async () => {
    const renderedHtml = `<!doctype html>
      <html lang="en">
        <head>
          <title>UGREEN DisplayPort Cable</title>
        </head>
        <body>
          <article class="product-detail" data-product-id="amazon-cable">
            <h1>UGREEN DisplayPort 2.1 Cable</h1>
            <p>DisplayPort cable for monitor connections supporting high refresh-rate video output.</p>
            <button>Add to Cart</button>
          </article>
        </body>
      </html>`;

    Object.defineProperty(service, 'browserEnabled', {
      value: true,
      configurable: true,
    });
    jest.spyOn(service as never, 'fetchHtmlWithPuppeteer' as never).mockResolvedValue({
      html: renderedHtml,
      method: 'puppeteer',
      renderedTitle: 'UGREEN DisplayPort Cable',
      renderedText:
        'UGREEN DisplayPort 2.1 Cable DisplayPort cable for monitor connections supporting high refresh-rate video output.',
      screenshot: Buffer.from('fixture-image'),
      primaryImageUrl: 'https://images.example.com/ugreen-cable.jpg',
    } as never);
    openAiService.response.mockResolvedValue({
      output_text: JSON.stringify({
        productName: 'UGREEN DisplayPort 2.1 Cable',
        description:
          'DisplayPort cable for monitor connections supporting high refresh-rate video output.',
        isProductPage: true,
        confidence: 0.92,
      }),
    });

    const result = await service.classifyUrl(
      'https://www.amazon.ca/UGREEN-DisplayPort-8K120Hz-Monitor-Compatible/dp/B0DSJ633D8/',
    );

    expect(httpService.get).not.toHaveBeenCalled();
    expect(result.type).toBe(UrlType.PRODUCT);
    expect(result.imageUrl).toBeUndefined();
    expect(result.metadata?.previewImageUrl).toBe(
      'https://images.example.com/ugreen-cable.jpg',
    );
    expect(result.metadata?.usedBrowser).toBe(true);
    expect(result.metadata?.extractionMethod).toBe('rendered-page-ai');
    expect(result.metadata?.productName).toBe('UGREEN DisplayPort 2.1 Cable');
    expect(result.metadata?.description).toContain('DisplayPort cable');
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
    expect(result.imageUrl).toBeUndefined();
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

  it('uses browser-derived product candidates for rendered listing pages', async () => {
    const lowSignalHtml =
      '<!doctype html><html><head><title>Loading</title></head><body><div id="root"></div></body></html>';

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
        productName: null,
        description: 'Rendered catalog page for drinkware and tabletop accessories.',
        isProductPage: false,
        confidence: 0.88,
      }),
    });

    Object.defineProperty(service, 'browserEnabled', {
      value: true,
      configurable: true,
    });
    jest.spyOn(service as never, 'fetchHtmlWithPuppeteer' as never).mockResolvedValue({
      html: '<!doctype html><html><body><main><article class="product-card"></article></main></body></html>',
      method: 'puppeteer',
      renderedTitle: 'Rendered Catalog',
      renderedText:
        'Insulated Stainless Steel Water Bottle Reusable bottle for beverages. Ceramic Coffee Mug Glazed ceramic mug with handle.',
      focusedTextSegments: [
        'Insulated Stainless Steel Water Bottle',
        'Reusable stainless steel bottle for beverages with screw cap.',
        'Ceramic Coffee Mug',
        'Glazed ceramic mug with handle for hot beverages.',
      ],
      browserProductCandidates: [
        {
          name: 'Insulated Stainless Steel Water Bottle',
          description:
            'Reusable stainless steel bottle for beverages with screw cap.',
          image: 'https://shop.example.com/images/bottle-rendered.png',
          price: '$24.99',
          currency: 'USD',
          source: 'rendered-dom',
        },
        {
          name: 'Ceramic Coffee Mug',
          description: 'Glazed ceramic mug with handle for hot beverages.',
          image: 'https://shop.example.com/images/mug-rendered.png',
          price: '$12.50',
          currency: 'USD',
          source: 'rendered-dom',
        },
      ],
      screenshot: Buffer.from('fixture-image'),
      primaryImageUrl: null,
    } as never);

    const result = await service.classifyUrl('https://shop.example.com/rendered-catalog');

    expect(result.type).toBe(UrlType.WEBPAGE);
    expect(result.metadata?.usedBrowser).toBe(true);
    expect(result.metadata?.isMultiProductPage).toBe(true);
    expect(result.metadata?.productCount).toBe(2);
    expect(result.metadata?.productCandidates).toEqual([
      expect.objectContaining({
        productName: 'Insulated Stainless Steel Water Bottle',
        imageUrl: 'https://shop.example.com/images/bottle-rendered.png',
        source: 'rendered-dom',
      }),
      expect.objectContaining({
        productName: 'Ceramic Coffee Mug',
        imageUrl: 'https://shop.example.com/images/mug-rendered.png',
        source: 'rendered-dom',
      }),
    ]);
  });
});
