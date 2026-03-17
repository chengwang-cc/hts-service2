import { SmartClassifyService } from './smart-classify.service';

describe('SmartClassifyService', () => {
  let searchService: {
    searchWithStandardization: jest.Mock;
    semanticSearchInChapters: jest.Mock;
  };
  let rerankService: {
    rerank: jest.Mock;
  };
  let service: SmartClassifyService;

  beforeEach(() => {
    searchService = {
      searchWithStandardization: jest.fn(),
      semanticSearchInChapters: jest.fn(),
    };
    rerankService = {
      rerank: jest.fn(async (_query, candidates) => candidates),
    };
    service = new SmartClassifyService(searchService as any, rerankService as any);
  });

  it('uses normalized hybrid retrieval and exposes hierarchy phases', async () => {
    searchService.searchWithStandardization.mockResolvedValue({
      originalQuery: '200 grams of coffee packaged in a glass jar',
      standardizedQuery: 'coffee packaged glass jar',
      searchPhrases: ['coffee packaged glass jar', 'packaged for retail sale'],
      headingHints: ['2101'],
      results: [
        {
          htsNumber: '7010.90.20.20',
          description: 'Glass containers',
          chapter: '70',
          score: 0.93,
          fullDescription: ['Glass containers'],
        },
        {
          htsNumber: '2101.11.21.26',
          description: 'Packaged for retail sale',
          chapter: '21',
          score: 0.91,
          fullDescription: ['Coffee extracts', 'Instant coffee', 'Packaged for retail sale'],
        },
        {
          htsNumber: '0901.90.20.00',
          description: 'Coffee substitutes containing coffee',
          chapter: '09',
          score: 0.88,
          fullDescription: ['Coffee substitutes'],
        },
      ],
    });
    searchService.semanticSearchInChapters.mockResolvedValue([
      {
        htsNumber: '2101.11.21.26',
        description: 'Packaged for retail sale',
        chapter: '21',
        similarity: 0.95,
        fullDescription: ['Coffee extracts', 'Instant coffee', 'Packaged for retail sale'],
      },
      {
        htsNumber: '2101.11.21.31',
        description: 'Packaged for retail sale',
        chapter: '21',
        similarity: 0.9,
        fullDescription: ['Coffee extracts', 'Instant coffee', 'Packaged for retail sale'],
      },
    ]);

    const result = await service.classify('200 grams of coffee packaged in a glass jar');

    expect(searchService.searchWithStandardization).toHaveBeenCalledWith(
      '200 grams of coffee packaged in a glass jar',
      60,
    );
    expect(searchService.semanticSearchInChapters).toHaveBeenCalledWith(
      'coffee packaged glass jar',
      expect.arrayContaining(['21']),
      40,
    );
    expect(result.phases.normalizedQuery).toBe('coffee packaged glass jar');
    expect(result.phases.topChapters).toContain('21');
    expect(result.phases.topHeadings).toContain('2101');
    expect(result.phases.topSubheadings).toContain('210111');
    expect(result.results[0].htsNumber).toBe('2101.11.21.26');
  });

  it('returns direct normalized search results for short queries until hierarchy is re-enabled', async () => {
    searchService.searchWithStandardization.mockResolvedValue({
      originalQuery: 'women cotton dress',
      standardizedQuery: 'women cotton dress',
      searchPhrases: ['women cotton dress'],
      headingHints: [],
      results: [
        {
          htsNumber: '6204.42.30.40',
          description: 'Women dresses of cotton',
          chapter: '62',
          score: 0.84,
          fullDescription: ['Women dresses', 'Of cotton'],
        },
        {
          htsNumber: '6104.42.00.10',
          description: 'Women dresses of cotton, knitted',
          chapter: '61',
          score: 0.83,
          fullDescription: ['Women dresses', 'Knitted', 'Of cotton'],
        },
      ],
    });
    searchService.semanticSearchInChapters.mockResolvedValue([]);

    const result = await service.classify('women cotton dress');

    expect(searchService.semanticSearchInChapters).not.toHaveBeenCalled();
    expect(rerankService.rerank).not.toHaveBeenCalled();
    expect(result.results[0].htsNumber).toBe('6204.42.30.40');
  });

  it('falls back to direct hybrid results for descriptive prose queries', async () => {
    searchService.searchWithStandardization.mockResolvedValue({
      originalQuery: '200 grams of coffee packaged in a glass jar',
      standardizedQuery: 'coffee packaged glass jar',
      searchPhrases: ['coffee packaged glass jar'],
      headingHints: [],
      results: [
        {
          htsNumber: '2101.11.21.26',
          description: 'Packaged for retail sale',
          chapter: '21',
          score: 1.12,
          fullDescription: ['Coffee extracts', 'Instant coffee', 'Packaged for retail sale'],
        },
        {
          htsNumber: '2101.11.21.31',
          description: 'Packaged for retail sale',
          chapter: '21',
          score: 0.85,
          fullDescription: ['Coffee extracts', 'Instant coffee', 'Packaged for retail sale'],
        },
        {
          htsNumber: '7010.90.20.20',
          description: 'Glass containers',
          chapter: '70',
          score: 0.61,
          fullDescription: ['Glass containers'],
        },
      ],
    });

    const result = await service.classify('200 grams of coffee packaged in a glass jar');

    expect(searchService.semanticSearchInChapters).not.toHaveBeenCalled();
    expect(rerankService.rerank).not.toHaveBeenCalled();
    expect(result.results[0].htsNumber).toBe('2101.11.21.26');
    expect(result.phases.topChapters).toContain('21');
    expect(result.phases.topHeadings).toContain('2101');
  });
});
