jest.mock('@hts/knowledgebase', () => ({
  HtsDocumentEntity: class HtsDocumentEntity {},
  KnowledgeChunkEntity: class KnowledgeChunkEntity {},
  DocumentService: class DocumentService {},
  NoteResolutionService: class NoteResolutionService {},
}));

import { KnowledgeAdminService } from './knowledge.admin.service';

describe('KnowledgeAdminService.uploadDocument', () => {
  function createHarness() {
    const documentRepo = {
      create: jest.fn((payload) => payload),
      save: jest.fn(async (payload) => ({
        id: payload.id || 'doc-1',
        ...payload,
      })),
    };
    const chunkRepo = {};
    const usitcDownloader = {
      findLatestRevision: jest.fn(),
      getPdfDownloadUrl: jest.fn(
        (year: number, revision: number) =>
          `https://hts.usitc.gov/reststop/file?release=${year}HTSRev${revision}&filename=finalCopy`,
      ),
    };
    const queueService = {
      sendJob: jest.fn(async () => 'job-1'),
    };

    const service = new KnowledgeAdminService(
      documentRepo as any,
      chunkRepo as any,
      usitcDownloader as any,
      queueService as any,
      {} as any,
      {} as any,
      {} as any,
    );

    return { service, documentRepo, usitcDownloader, queueService };
  }

  it('includes the requested revision in document provenance', async () => {
    const { service, documentRepo, usitcDownloader } = createHarness();

    await service.uploadDocument({
      year: 2026,
      revision: 7,
      chapter: '00',
    });

    expect(usitcDownloader.getPdfDownloadUrl).toHaveBeenCalledWith(2026, 7);
    expect(documentRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceVersion: '2026_revision_7',
        sourceUrl:
          'https://hts.usitc.gov/reststop/file?release=2026HTSRev7&filename=finalCopy',
        metadata: expect.objectContaining({
          sourceRevision: 7,
          officialSourceVersion: '2026_revision_7',
        }),
      }),
    );
  });

  it('includes the detected latest revision in document provenance', async () => {
    const { service, documentRepo, usitcDownloader } = createHarness();
    usitcDownloader.findLatestRevision.mockResolvedValue({
      year: 2026,
      revision: 8,
      jsonUrl:
        'https://www.usitc.gov/sites/default/files/tata/hts/hts_2026_revision_8_json.json',
      pdfUrl:
        'https://hts.usitc.gov/reststop/file?release=2026HTSRev8&filename=finalCopy',
    });

    await service.uploadDocument({
      version: 'latest',
      chapter: '00',
    });

    expect(documentRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceVersion: '2026_revision_8',
        sourceUrl:
          'https://hts.usitc.gov/reststop/file?release=2026HTSRev8&filename=finalCopy',
        metadata: expect.objectContaining({
          sourceRevision: 8,
          officialSourceVersion: '2026_revision_8',
        }),
      }),
    );
  });
});
