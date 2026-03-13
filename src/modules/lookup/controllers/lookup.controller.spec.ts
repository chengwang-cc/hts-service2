import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { LookupController } from './lookup.controller';
import { UrlType } from '../dto/classify-url.dto';

describe('LookupController', () => {
  const searchService = {} as any;
  const noteResolutionService = {} as any;
  const lookupConversationAgentService = {} as any;
  const queueService = {} as any;
  const rerankService = {} as any;
  const smartClassifyService = {} as any;

  let urlClassifierService: { classifyUrl: jest.Mock };
  let classificationService: { classifyProduct: jest.Mock };
  let visionService: { analyzeProductImage: jest.Mock };
  let controller: LookupController;
  const originalFetch = global.fetch;

  beforeEach(() => {
    urlClassifierService = {
      classifyUrl: jest.fn(),
    };
    classificationService = {
      classifyProduct: jest.fn(),
    };
    visionService = {
      analyzeProductImage: jest.fn(),
    };

    controller = new LookupController(
      searchService,
      urlClassifierService as any,
      classificationService as any,
      visionService as any,
      noteResolutionService,
      lookupConversationAgentService,
      queueService,
      rerankService,
      smartClassifyService,
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns persisted classification ids and image evidence for uploaded images', async () => {
    const image = {
      buffer: Buffer.from('image-bytes'),
      originalname: 'sample.png',
      mimetype: 'image/png',
      size: 11,
    } as Express.Multer.File;
    const imageHash = createHash('sha256').update(image.buffer).digest('hex');

    visionService.analyzeProductImage.mockResolvedValue({
      products: [
        {
          name: 'Steel bottle',
          description: 'Insulated beverage container',
          materials: ['stainless steel'],
          brand: 'Acme',
          confidence: 0.94,
        },
      ],
    });
    classificationService.classifyProduct.mockResolvedValue({
      id: 'cls_123',
      htsCode: '7323.93.0080',
      description: 'Table, kitchen or other household articles of stainless steel',
      confidence: 0.87,
      reasoning: 'Matches a stainless steel insulated household container.',
      chapter: '73',
      candidates: [],
    });

    const result = await controller.classifyHtsFromImage(
      { organizationId: 'org_1' },
      image,
    );

    expect(classificationService.classifyProduct).toHaveBeenCalledWith(
      'Steel bottle, Insulated beverage container, stainless steel',
      'org_1',
      expect.objectContaining({
        inputMethod: 'IMAGE_UPLOAD',
        sourceImageHash: imageHash,
        sourceEvidence: expect.objectContaining({
          originalFilename: 'sample.png',
          mimeType: 'image/png',
          sizeBytes: 11,
          visionUsed: true,
        }),
      }),
    );
    expect(result.data.id).toBe('cls_123');
    expect(result.data.source.detectedProduct.name).toBe('Steel bottle');
  });

  it('persists source page and image evidence for URL classification', async () => {
    urlClassifierService.classifyUrl.mockResolvedValue({
      type: UrlType.PRODUCT,
      imageUrl: 'https://example.com/product.png',
      metadata: {
        title: 'Insulated steel bottle',
        productName: 'Insulated steel bottle',
        description: 'Vacuum bottle for beverages',
      },
    });
    visionService.analyzeProductImage.mockResolvedValue({
      products: [
        {
          name: 'Steel bottle',
          description: 'Insulated beverage container',
          materials: ['stainless steel'],
          brand: 'Acme',
          confidence: 0.94,
        },
      ],
    });
    classificationService.classifyProduct.mockResolvedValue({
      id: 'cls_url',
      htsCode: '7323.93.0080',
      description: 'Table, kitchen or other household articles of stainless steel',
      confidence: 0.87,
      reasoning: 'Matches a stainless steel insulated household container.',
      chapter: '73',
      candidates: [],
    });

    const result = await controller.classifyHtsFromUrl(
      { organizationId: 'org_1' },
      { url: 'https://example.com/product' },
    );

    expect(classificationService.classifyProduct).toHaveBeenCalledWith(
      'Steel bottle, Insulated beverage container, stainless steel',
      'org_1',
      expect.objectContaining({
        inputMethod: 'PRODUCT_URL',
        sourceUrl: 'https://example.com/product',
        sourceImageUrl: 'https://example.com/product.png',
        sourceEvidence: expect.objectContaining({
          urlType: UrlType.PRODUCT,
          visionUsed: true,
        }),
      }),
    );
    expect(result.data.id).toBe('cls_url');
    expect(result.data.source.url).toBe('https://example.com/product');
  });

  it('rejects uploaded images when no product is detected', async () => {
    visionService.analyzeProductImage.mockResolvedValue({ products: [] });

    await expect(
      controller.classifyHtsFromImage(
        { organizationId: 'org_1' },
        {
          buffer: Buffer.from('image-bytes'),
          originalname: 'sample.png',
          mimetype: 'image/png',
          size: 11,
        } as Express.Multer.File,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('downloads the extracted image server-side when direct vision URL fetch fails', async () => {
    urlClassifierService.classifyUrl.mockResolvedValue({
      type: UrlType.PRODUCT,
      imageUrl: 'http://127.0.0.1:4200/e2e/bottle-fixture-small.png?rendered=1',
      metadata: {
        title: 'Rendered bottle fixture',
        productName: 'Rendered bottle fixture',
        description: 'Rendered browser product page',
      },
    });

    visionService.analyzeProductImage
      .mockRejectedValueOnce(
        new Error(
          'Failed to analyze image: 400 Error while downloading http://127.0.0.1:4200/e2e/bottle-fixture-small.png?rendered=1. Upstream status code: 407.',
        ),
      )
      .mockResolvedValueOnce({
        products: [
          {
            name: 'Steel bottle',
            description: 'Insulated beverage container',
            materials: ['stainless steel'],
            brand: 'Acme',
            confidence: 0.94,
          },
        ],
      });
    classificationService.classifyProduct.mockResolvedValue({
      id: 'cls_rendered',
      htsCode: '7323.93.0080',
      description: 'Table, kitchen or other household articles of stainless steel',
      confidence: 0.87,
      reasoning: 'Matches a stainless steel insulated household container.',
      chapter: '73',
      candidates: [],
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: (name: string) => {
          if (name === 'content-type') return 'image/png';
          if (name === 'content-length') return '4';
          return null;
        },
      },
      arrayBuffer: async () => Uint8Array.from([0x89, 0x50, 0x4e, 0x47]).buffer,
    } as any);

    const result = await controller.classifyHtsFromUrl(
      { organizationId: 'org_1' },
      { url: 'http://127.0.0.1:4200/e2e/rendered-product-fixture.html' },
    );

    expect(global.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:4200/e2e/bottle-fixture-small.png?rendered=1',
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: expect.stringContaining('image/'),
        }),
      }),
    );
    expect(visionService.analyzeProductImage).toHaveBeenNthCalledWith(
      1,
      'http://127.0.0.1:4200/e2e/bottle-fixture-small.png?rendered=1',
      expect.any(Object),
    );
    expect(visionService.analyzeProductImage).toHaveBeenNthCalledWith(
      2,
      expect.any(Buffer),
      expect.any(Object),
    );
    expect(result.data.id).toBe('cls_rendered');
  });
});
