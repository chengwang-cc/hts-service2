jest.mock('../../lookup/services/search.service', () => ({
  SearchService: class SearchService {},
}));

jest.mock('../../lookup/services/smart-classify.service', () => ({
  SmartClassifyService: class SmartClassifyService {},
}));

import { BatchWorkerService } from './batch-worker.service';

describe('BatchWorkerService', () => {
  let queueService: { registerHandler: jest.Mock };
  let batchJobService: {
    claimPendingItem: jest.Mock;
    recordItemResult: jest.Mock;
    markItemSkipped: jest.Mock;
    requeueItem: jest.Mock;
    startJobExecution: jest.Mock;
  };
  let searchService: {
    searchWithStandardization: jest.Mock;
  };
  let smartClassifyService: {
    classify: jest.Mock;
  };
  let jobRepo: {
    findOne: jest.Mock;
  };
  let service: BatchWorkerService;

  beforeEach(() => {
    queueService = {
      registerHandler: jest.fn(),
    };
    batchJobService = {
      claimPendingItem: jest.fn(),
      recordItemResult: jest.fn(),
      markItemSkipped: jest.fn(),
      requeueItem: jest.fn(),
      startJobExecution: jest.fn(),
    };
    searchService = {
      searchWithStandardization: jest.fn(),
    };
    smartClassifyService = {
      classify: jest.fn(),
    };
    jobRepo = {
      findOne: jest.fn(),
    };

    service = new BatchWorkerService(
      queueService as any,
      batchJobService as any,
      searchService as any,
      smartClassifyService as any,
      jobRepo as any,
    );
  });

  it('uses standardized hybrid search for autocomplete batch items and persists normalization metadata', async () => {
    jobRepo.findOne.mockResolvedValue({
      status: 'running',
      method: 'autocomplete',
    });
    batchJobService.claimPendingItem.mockResolvedValue({
      id: 'item-1',
      query: '200 grams of roasted ground coffee in glass jar',
      status: 'running',
    });
    searchService.searchWithStandardization.mockResolvedValue({
      originalQuery: '200 grams of roasted ground coffee in glass jar',
      standardizedQuery: 'roasted ground coffee packaged glass jar',
      searchPhrases: [
        'roasted ground coffee packaged glass jar',
        'packaged for retail sale',
      ],
      headingHints: ['2101'],
      results: [
        {
          htsNumber: '2101.11.21.26',
          description: 'Coffee extracts, packaged for retail sale',
          fullDescription: ['Coffee extracts', 'Packaged for retail sale'],
          score: 0.92,
        },
      ],
    });

    await (service as any).processItem('job-1', 'item-1');

    expect(searchService.searchWithStandardization).toHaveBeenCalledWith(
      '200 grams of roasted ground coffee in glass jar',
      5,
    );
    expect(batchJobService.recordItemResult).toHaveBeenCalledWith(
      'job-1',
      'item-1',
      expect.objectContaining({
        htsNumber: '2101.11.21.26',
        confidence: 0.92,
        phases: {
          normalizedQuery: 'roasted ground coffee packaged glass jar',
          searchPhrases: [
            'roasted ground coffee packaged glass jar',
            'packaged for retail sale',
          ],
          headingHints: ['2101'],
        },
      }),
    );
  });
});
