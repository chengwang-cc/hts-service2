import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { LookupController } from './lookup.controller';

describe('LookupController', () => {
  const searchService = {} as any;
  const urlClassifierService = {} as any;
  const noteResolutionService = {} as any;
  const lookupConversationAgentService = {} as any;
  const queueService = {} as any;
  const rerankService = {} as any;
  const smartClassifyService = {} as any;
  const visionService = {} as any;

  let lookupClassificationJobService: {
    createUrlJob: jest.Mock;
    createImageJob: jest.Mock;
    getJob: jest.Mock;
  };
  let controller: LookupController;

  beforeEach(() => {
    lookupClassificationJobService = {
      createUrlJob: jest.fn(),
      createImageJob: jest.fn(),
      getJob: jest.fn(),
    };

    controller = new LookupController(
      searchService,
      urlClassifierService,
      lookupClassificationJobService as any,
      noteResolutionService,
      lookupConversationAgentService,
      queueService,
      rerankService,
      smartClassifyService,
      visionService,
    );
  });

  it('enqueues URL classification jobs asynchronously', async () => {
    lookupClassificationJobService.createUrlJob.mockResolvedValue({
      id: 'job_url_1',
      status: 'pending',
      requestType: 'URL',
    });

    const result = await controller.classifyHtsFromUrl(
      { organizationId: 'org_1', id: 'user_1' },
      { url: 'https://example.com/product' },
    );

    expect(lookupClassificationJobService.createUrlJob).toHaveBeenCalledWith(
      { organizationId: 'org_1', id: 'user_1' },
      'https://example.com/product',
    );
    expect(result).toEqual({
      success: true,
      data: {
        id: 'job_url_1',
        status: 'pending',
        requestType: 'URL',
      },
    });
  });

  it('enqueues image classification jobs asynchronously', async () => {
    const image = {
      buffer: Buffer.from('image-bytes'),
      originalname: 'sample.png',
      mimetype: 'image/png',
      size: 11,
    } as Express.Multer.File;

    lookupClassificationJobService.createImageJob.mockResolvedValue({
      id: 'job_img_1',
      status: 'pending',
      requestType: 'IMAGE_UPLOAD',
    });

    const result = await controller.classifyHtsFromImage(
      { organizationId: 'org_1', id: 'user_1' },
      image,
    );

    expect(lookupClassificationJobService.createImageJob).toHaveBeenCalledWith(
      { organizationId: 'org_1', id: 'user_1' },
      image,
    );
    expect(result).toEqual({
      success: true,
      data: {
        id: 'job_img_1',
        status: 'pending',
        requestType: 'IMAGE_UPLOAD',
      },
    });
  });

  it('returns classification job status for the authenticated organization', async () => {
    lookupClassificationJobService.getJob.mockResolvedValue({
      id: 'job_status_1',
      status: 'completed',
      requestType: 'URL',
      result: { htsCode: '6204.63.35', description: 'Synthetic fiber trousers' },
    });

    const result = await controller.getClassificationJob(
      { organizationId: 'org_1' },
      'job_status_1',
    );

    expect(lookupClassificationJobService.getJob).toHaveBeenCalledWith(
      'job_status_1',
      'org_1',
    );
    expect(result.success).toBe(true);
    expect(result.data.status).toBe('completed');
  });

  it('rejects missing uploaded images before queueing', async () => {
    await expect(
      controller.classifyHtsFromImage(
        { organizationId: 'org_1', id: 'user_1' },
        undefined as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects unauthenticated job status polling', async () => {
    await expect(
      controller.getClassificationJob({ organizationId: null }, 'job_1'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
