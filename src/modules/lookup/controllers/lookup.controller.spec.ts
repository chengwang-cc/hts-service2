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
});
