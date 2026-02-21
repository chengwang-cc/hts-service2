import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { HtsExtraTaxEntity, OpenAiService } from '@hts/core';
import { RefreshReciprocalTariffDto } from '../dto/reciprocal-tariff.dto';

type SourceFetchResult = {
  url: string;
  ok: boolean;
  status?: number;
  fetchedAt: string;
  contentLength?: number;
  error?: string;
};

type ReciprocalPolicyCandidate = {
  taxCode: string;
  taxName: string;
  description: string;
  countryCode: string;
  extraRateType: 'ADD_ON' | 'CONDITIONAL';
  ratePercent: number;
  rateText: string;
  rateFormula: string;
  htsNumber: string | null;
  htsChapter: string | null;
  effectiveDate: string | null;
  expirationDate: string | null;
  legalReference: string;
  notes: string;
  conditions: Record<string, any> | null;
  priority: number;
  sourceUrl: string;
  sourceTitle: string;
  sourceType:
    | 'CBP_FAQ'
    | 'CBP_STATEMENT'
    | 'WHITE_HOUSE'
    | 'FEDERAL_REGISTER'
    | 'AI_WEB_SEARCH';
};

type ReciprocalMethodReference = {
  derivedFrom: string[];
  narrative: string;
  formulaInferred: string;
  parameters: {
    epsilonAbsolute: number;
    passthroughPhi: number;
  };
  simplifiedEquivalent: string;
};

@Injectable()
export class ReciprocalTariffAdminService {
  private readonly logger = new Logger(ReciprocalTariffAdminService.name);

  private readonly officialUrls = {
    cbpFaq:
      'https://www.cbp.gov/trade/programs-administration/trade-remedies/IEEPA-FAQ',
    cbpStatement:
      'https://www.cbp.gov/newsroom/announcements/official-cbp-statement-liberation-day',
    federalRegisterDocuments: [
      'https://www.federalregister.gov/documents/2025/04/07/2025-06063/regulating-imports-with-a-reciprocal-tariff-to-rectify-trade-practices-that-contribute-to-large-and',
      'https://www.federalregister.gov/documents/2025/04/14/2025-06378/amendment-to-reciprocal-tariffs-and-updated-duties-as-applied-to-low-value-imports-from-the-peoples',
      'https://www.federalregister.gov/documents/2025/04/15/2025-06462/modifying-reciprocal-tariff-rates-to-reflect-trading-partner-retaliation-and-alignment',
      'https://www.federalregister.gov/documents/2025/05/21/2025-09297/modifying-reciprocal-tariff-rates-to-reflect-discussions-with-the-peoples-republic-of-china',
      'https://www.federalregister.gov/documents/2025/07/10/2025-12962/extending-the-modification-of-the-reciprocal-tariff-rates',
      'https://www.federalregister.gov/documents/2025/08/06/2025-15010/further-modifying-the-reciprocal-tariff-rates',
      'https://www.federalregister.gov/documents/2025/08/14/2025-15554/further-modifying-reciprocal-tariff-rates-to-reflect-ongoing-discussions-with-the-peoples-republic',
      'https://www.federalregister.gov/documents/2025/09/10/2025-17507/modifying-the-scope-of-reciprocal-tariffs-and-establishing-procedures-for-implementing-trade-and',
      'https://www.federalregister.gov/documents/2025/11/07/2025-19826/modifying-reciprocal-tariff-rates-consistent-with-the-economic-and-trade-arrangement-between-the',
      'https://www.federalregister.gov/documents/2025/11/25/2025-21203/modifying-the-scope-of-the-reciprocal-tariffs-with-respect-to-certain-agricultural-products',
    ],
  };

  private readonly whiteHousePolicyPages = [
    'https://www.whitehouse.gov/presidential-actions/2025/08/addressing-threats-to-the-united-states-by-the-government-of-brazil/',
    'https://www.whitehouse.gov/briefings-statements/2025/08/fact-sheet-president-donald-j-trump-secures-historic-trade-win-for-the-united-states/',
    'https://www.whitehouse.gov/briefings-statements/2025/07/fact-sheet-president-donald-j-trump-secures-historic-trade-deal-with-indonesia/',
    'https://www.whitehouse.gov/briefings-statements/2025/07/fact-sheet-president-donald-j-trump-secures-historic-trade-deal-with-the-philippines/',
    'https://www.whitehouse.gov/briefings-statements/2025/07/fact-sheet-president-donald-j-trump-secures-historic-trade-deal-with-vietnam/',
    'https://www.whitehouse.gov/briefings-statements/2025/07/fact-sheet-president-donald-j-trump-secures-historic-trade-deal-with-japan/',
    'https://www.whitehouse.gov/briefings-statements/2025/06/fact-sheet-president-donald-j-trump-secures-historic-trade-deal-with-the-united-kingdom/',
    'https://www.whitehouse.gov/briefings-statements/2025/07/fact-sheet-president-donald-j-trump-secures-historic-trade-deal-with-south-korea/',
    'https://www.whitehouse.gov/briefings-statements/2025/07/fact-sheet-president-donald-j-trump-secures-historic-trade-deal-with-thailand-and-cambodia/',
  ];

  private readonly countryNameToCode: Record<string, string> = {
    brazil: 'BR',
    china: 'CN',
    indonesia: 'ID',
    philippines: 'PH',
    vietnam: 'VN',
    japan: 'JP',
    'united kingdom': 'GB',
    'south korea': 'KR',
    thailand: 'TH',
    cambodia: 'KH',
    'european union': 'EU',
  };

  constructor(
    @InjectRepository(HtsExtraTaxEntity)
    private readonly extraTaxRepo: Repository<HtsExtraTaxEntity>,
  ) {}

  async refreshFromOfficialSources(
    dto: RefreshReciprocalTariffDto,
    userId?: string,
  ): Promise<{
    dryRun: boolean;
    deactivatedCount: number;
    created: number;
    updated: number;
    sourcesChecked: SourceFetchResult[];
    appliedPolicies: ReciprocalPolicyCandidate[];
    skippedPolicies: Array<{ taxCode: string; reason: string }>;
    supplementalReferences: {
      trackerUrl: string | null;
      methodPdfPath: string | null;
      methodModel: ReciprocalMethodReference;
      trackerCrossCheck: {
        baselineDetected: boolean;
        transshipmentPenaltyDetected: boolean;
      } | null;
      officialFederalRegisterDocs: string[];
    };
  }> {
    const dryRun = dto.dryRun ?? false;
    const deactivatePrevious = dto.deactivatePrevious ?? true;
    const useAiDeepSearch = dto.useAiDeepSearch ?? true;

    const sourcesChecked: SourceFetchResult[] = [];
    const candidates: ReciprocalPolicyCandidate[] = [];
    const methodModel = this.getMethodModelFromOfficialSources();

    const cbpFaqHtml = await this.fetchPage(
      this.officialUrls.cbpFaq,
      sourcesChecked,
    );
    if (cbpFaqHtml) {
      candidates.push(
        ...this.extractFromCbpFaq(cbpFaqHtml, this.officialUrls.cbpFaq),
      );
    }

    const cbpStatementHtml = await this.fetchPage(
      this.officialUrls.cbpStatement,
      sourcesChecked,
    );
    if (cbpStatementHtml) {
      candidates.push(
        ...this.extractFromCbpStatement(
          cbpStatementHtml,
          this.officialUrls.cbpStatement,
        ),
      );
    }

    for (const frUrl of this.officialUrls.federalRegisterDocuments) {
      const federalRegisterHtml = await this.fetchPage(frUrl, sourcesChecked);
      if (!federalRegisterHtml) {
        continue;
      }
      candidates.push(
        ...this.extractFromFederalRegister(federalRegisterHtml, frUrl),
      );
    }

    for (const url of this.whiteHousePolicyPages) {
      const html = await this.fetchPage(url, sourcesChecked, 15_000);
      if (!html) continue;
      candidates.push(...this.extractFromWhiteHousePolicy(html, url));
    }

    const trackerCrossCheck = null;

    if (useAiDeepSearch) {
      const aiCandidates = await this.extractPoliciesWithAiWebSearch();
      candidates.push(...aiCandidates);
    }

    const dedupedCandidates = this.dedupeCandidates(candidates);
    if (dedupedCandidates.length === 0) {
      throw new Error(
        'No reciprocal tariff policies were extracted from official sources.',
      );
    }

    let deactivatedCount = 0;
    const skippedPolicies: Array<{ taxCode: string; reason: string }> = [];
    let created = 0;
    let updated = 0;

    if (deactivatePrevious) {
      const existingActiveReciprocal = await this.extraTaxRepo
        .createQueryBuilder('tax')
        .where('tax.taxCode LIKE :prefix', { prefix: 'RECIP_%' })
        .andWhere('tax.isActive = :active', { active: true })
        .getMany();

      deactivatedCount = existingActiveReciprocal.length;
      if (!dryRun && existingActiveReciprocal.length > 0) {
        for (const item of existingActiveReciprocal) {
          item.isActive = false;
          item.expirationDate = new Date();
        }
        await this.extraTaxRepo.save(existingActiveReciprocal);
      }
    }

    for (const policy of dedupedCandidates) {
      if (policy.ratePercent < 0 || policy.ratePercent > 200) {
        skippedPolicies.push({
          taxCode: policy.taxCode,
          reason: `out_of_bounds_rate_percent:${policy.ratePercent}`,
        });
        continue;
      }

      if (dryRun) {
        continue;
      }

      const existingQuery = this.extraTaxRepo
        .createQueryBuilder('tax')
        .where('tax.taxCode = :taxCode', { taxCode: policy.taxCode })
        .andWhere('tax.countryCode = :countryCode', {
          countryCode: policy.countryCode,
        })
        .andWhere('tax.isActive = :isActive', { isActive: true });

      if (policy.htsNumber == null) {
        existingQuery.andWhere('tax.htsNumber IS NULL');
      } else {
        existingQuery.andWhere('tax.htsNumber = :htsNumber', {
          htsNumber: policy.htsNumber,
        });
      }

      const existing = await existingQuery
        .orderBy('tax.updatedAt', 'DESC')
        .getOne();

      const payload: Partial<HtsExtraTaxEntity> = {
        taxCode: policy.taxCode,
        taxName: policy.taxName,
        description: policy.description,
        htsNumber: policy.htsNumber,
        htsChapter: policy.htsChapter,
        countryCode: policy.countryCode,
        extraRateType: policy.extraRateType,
        rateText: policy.rateText,
        rateFormula: policy.rateFormula,
        minimumAmount: null,
        maximumAmount: null,
        isPercentage: true,
        applyTo: 'VALUE',
        conditions: policy.conditions,
        priority: policy.priority,
        isActive: true,
        effectiveDate: this.parseDate(policy.effectiveDate),
        expirationDate: this.parseDate(policy.expirationDate),
        legalReference: policy.legalReference,
        notes: policy.notes,
        metadata: {
          source: policy.sourceType,
          sourceUrl: policy.sourceUrl,
          sourceTitle: policy.sourceTitle,
          supplementalReferences: {
            trackerUrl: null,
            methodPdfPath: null,
            officialFederalRegisterDocs:
              this.officialUrls.federalRegisterDocuments,
            reciprocalMethodModel: methodModel,
          },
          refreshedBy: userId || null,
          refreshedAt: new Date().toISOString(),
          policyType: 'RECIPROCAL_TARIFF',
        },
      };

      if (existing) {
        Object.assign(existing, payload);
        await this.extraTaxRepo.save(existing);
        updated += 1;
      } else {
        const createdEntity = this.extraTaxRepo.create(payload);
        await this.extraTaxRepo.save(createdEntity);
        created += 1;
      }
    }

    return {
      dryRun,
      deactivatedCount,
      created,
      updated,
      sourcesChecked,
      appliedPolicies: dedupedCandidates,
      skippedPolicies,
      supplementalReferences: {
        trackerUrl: null,
        methodPdfPath: null,
        methodModel,
        trackerCrossCheck,
        officialFederalRegisterDocs: this.officialUrls.federalRegisterDocuments,
      },
    };
  }

  private async fetchPage(
    url: string,
    ledger: SourceFetchResult[],
    timeoutMs = 30_000,
  ): Promise<string | null> {
    try {
      const response = await axios.get(url, {
        timeout: timeoutMs,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });
      const body =
        typeof response.data === 'string'
          ? response.data
          : JSON.stringify(response.data);
      ledger.push({
        url,
        ok: true,
        status: response.status,
        fetchedAt: new Date().toISOString(),
        contentLength: body.length,
      });
      return body;
    } catch (error: any) {
      ledger.push({
        url,
        ok: false,
        status: error?.response?.status,
        fetchedAt: new Date().toISOString(),
        error: error?.message || 'unknown error',
      });
      this.logger.warn(
        `Failed to fetch official reciprocal source ${url}: ${error?.message || 'unknown error'}`,
      );
      return null;
    }
  }

  private extractFromCbpStatement(
    html: string,
    url: string,
  ): ReciprocalPolicyCandidate[] {
    const text = this.stripHtml(html);
    const output: ReciprocalPolicyCandidate[] = [];
    const hasBaselineSignal =
      /10%\s+tariff/i.test(text) &&
      /all countries/i.test(text) &&
      /April 5,\s*2025/i.test(text);

    if (hasBaselineSignal) {
      output.push({
        taxCode: 'RECIP_BASELINE_9903_01_25',
        taxName: 'Reciprocal Tariff Baseline',
        description:
          'Baseline reciprocal tariff under IEEPA framework for countries subject to 9903.01.25.',
        countryCode: 'ALL',
        extraRateType: 'ADD_ON',
        ratePercent: 10,
        rateText: '10% ad valorem',
        rateFormula: 'value * 0.10',
        htsNumber: '*',
        htsChapter: '99',
        effectiveDate: '2025-04-05',
        expirationDate: null,
        legalReference:
          'IEEPA reciprocal tariff framework; CBP official statement',
        notes:
          'Applies as baseline reciprocal tariff layer; exclusions/exceptions and country-specific updates must be evaluated separately.',
        conditions: {
          htsHeading: '9903.01.25',
          exclusions: [
            'USMCA-eligible imports from CA/MX',
            'article-level Annex exclusions',
          ],
        },
        priority: 15,
        sourceUrl: url,
        sourceTitle:
          'Official CBP Statement on Liberation Day reciprocal tariff implementation',
        sourceType: 'CBP_STATEMENT',
      });
    }

    return output;
  }

  private extractFromCbpFaq(
    html: string,
    url: string,
  ): ReciprocalPolicyCandidate[] {
    const text = this.stripHtml(html);
    const output: ReciprocalPolicyCandidate[] = [];

    if (
      /April 9,\s*2025/i.test(text) &&
      /9903\.01\.63/i.test(text) &&
      /84%/i.test(text)
    ) {
      output.push({
        taxCode: 'RECIP_CN_9903_01_63_84',
        taxName: 'Reciprocal Tariff China (84%)',
        description:
          'China reciprocal tariff surcharge under heading 9903.01.63 at 84%.',
        countryCode: 'CN',
        extraRateType: 'ADD_ON',
        ratePercent: 84,
        rateText: '84% ad valorem',
        rateFormula: 'value * 0.84',
        htsNumber: '*',
        htsChapter: '99',
        effectiveDate: '2025-04-09',
        expirationDate: '2025-04-09',
        legalReference: 'CBP IEEPA FAQ (China reciprocal tariff timeline)',
        notes: 'Short transitional period listed in CBP guidance.',
        conditions: { htsHeading: '9903.01.63' },
        priority: 14,
        sourceUrl: url,
        sourceTitle: 'CBP IEEPA FAQ',
        sourceType: 'CBP_FAQ',
      });
    }

    if (
      /April 10,\s*2025\s+through\s+May 13,\s*2025/i.test(text) &&
      /9903\.01\.63/i.test(text) &&
      /125%/i.test(text)
    ) {
      output.push({
        taxCode: 'RECIP_CN_9903_01_63_125',
        taxName: 'Reciprocal Tariff China (125%)',
        description:
          'China reciprocal tariff surcharge under heading 9903.01.63 at 125% during listed window.',
        countryCode: 'CN',
        extraRateType: 'ADD_ON',
        ratePercent: 125,
        rateText: '125% ad valorem',
        rateFormula: 'value * 1.25',
        htsNumber: '*',
        htsChapter: '99',
        effectiveDate: '2025-04-10',
        expirationDate: '2025-05-13',
        legalReference: 'CBP IEEPA FAQ (China reciprocal tariff timeline)',
        notes: 'Temporary increase period published by CBP.',
        conditions: { htsHeading: '9903.01.63' },
        priority: 14,
        sourceUrl: url,
        sourceTitle: 'CBP IEEPA FAQ',
        sourceType: 'CBP_FAQ',
      });
    }

    if (
      /May 14,\s*2025/i.test(text) &&
      /9903\.01\.25/i.test(text) &&
      /10%/i.test(text)
    ) {
      output.push({
        taxCode: 'RECIP_CN_9903_01_25_10',
        taxName: 'Reciprocal Tariff China (10% current baseline)',
        description:
          'Current China reciprocal tariff surcharge under heading 9903.01.25 at 10% as listed by CBP.',
        countryCode: 'CN',
        extraRateType: 'ADD_ON',
        ratePercent: 10,
        rateText: '10% ad valorem',
        rateFormula: 'value * 0.10',
        htsNumber: '*',
        htsChapter: '99',
        effectiveDate: '2025-05-14',
        expirationDate: null,
        legalReference: 'CBP IEEPA FAQ (China reciprocal tariff timeline)',
        notes: 'Current baseline level referenced in CBP FAQ.',
        conditions: { htsHeading: '9903.01.25' },
        priority: 14,
        sourceUrl: url,
        sourceTitle: 'CBP IEEPA FAQ',
        sourceType: 'CBP_FAQ',
      });
    }

    if (/9903\.01\.26/i.test(text)) {
      output.push({
        taxCode: 'RECIP_CA_EXCEPTION_9903_01_26',
        taxName: 'Reciprocal Tariff Exception (Canada/USMCA)',
        description:
          'Policy exception marker for imports entered under 9903.01.26 where baseline reciprocal tariffs are not applied.',
        countryCode: 'CA',
        extraRateType: 'CONDITIONAL',
        ratePercent: 0,
        rateText: '0% (exception marker)',
        rateFormula: '0',
        htsNumber: '*',
        htsChapter: '99',
        effectiveDate: '2025-04-05',
        expirationDate: null,
        legalReference: 'CBP IEEPA FAQ (USMCA exception references)',
        notes:
          'Stored for policy traceability; not directly charged as additional tariff.',
        conditions: {
          exceptionHeading: '9903.01.26',
          excludesReciprocalBaseline: true,
        },
        priority: 5,
        sourceUrl: url,
        sourceTitle: 'CBP IEEPA FAQ',
        sourceType: 'CBP_FAQ',
      });
    }

    if (/9903\.01\.27/i.test(text)) {
      output.push({
        taxCode: 'RECIP_MX_EXCEPTION_9903_01_27',
        taxName: 'Reciprocal Tariff Exception (Mexico/USMCA)',
        description:
          'Policy exception marker for imports entered under 9903.01.27 where baseline reciprocal tariffs are not applied.',
        countryCode: 'MX',
        extraRateType: 'CONDITIONAL',
        ratePercent: 0,
        rateText: '0% (exception marker)',
        rateFormula: '0',
        htsNumber: '*',
        htsChapter: '99',
        effectiveDate: '2025-04-05',
        expirationDate: null,
        legalReference: 'CBP IEEPA FAQ (USMCA exception references)',
        notes:
          'Stored for policy traceability; not directly charged as additional tariff.',
        conditions: {
          exceptionHeading: '9903.01.27',
          excludesReciprocalBaseline: true,
        },
        priority: 5,
        sourceUrl: url,
        sourceTitle: 'CBP IEEPA FAQ',
        sourceType: 'CBP_FAQ',
      });
    }

    return output;
  }

  private extractFromFederalRegister(
    html: string,
    url: string,
  ): ReciprocalPolicyCandidate[] {
    const text = this.stripHtml(html);
    if (
      !/reciprocal tariff/i.test(text) &&
      !/Executive Order 14\d{3}/i.test(text)
    ) {
      return [];
    }

    const documentNumber = this.extractFederalRegisterDocumentNumber(url);
    if (!documentNumber) {
      return [];
    }
    const publicationDate = this.extractFederalRegisterPublicationDate(url);
    const title =
      this.extractTitle(html) || `Federal Register Document ${documentNumber}`;

    return [
      {
        taxCode: `RECIP_POLICY_NOTICE_${documentNumber.replace(/-/g, '_')}`,
        taxName: 'Reciprocal Tariff Policy Notice Marker',
        description:
          'Federal Register policy marker for reciprocal tariff updates and scope/rate changes.',
        countryCode: 'ALL',
        extraRateType: 'CONDITIONAL',
        ratePercent: 0,
        rateText: '0% (policy marker)',
        rateFormula: '0',
        htsNumber: '*',
        htsChapter: '99',
        effectiveDate: publicationDate,
        expirationDate: null,
        legalReference: `Federal Register Doc. ${documentNumber} (reciprocal tariff policy update)`,
        notes: `Policy marker for audit/traceability from Federal Register document ${documentNumber}.`,
        conditions: {
          documentId: documentNumber,
          policyMarkerOnly: true,
        },
        priority: 2,
        sourceUrl: url,
        sourceTitle: title,
        sourceType: 'FEDERAL_REGISTER',
      },
    ];
  }

  private extractFromWhiteHousePolicy(
    html: string,
    url: string,
  ): ReciprocalPolicyCandidate[] {
    const text = this.stripHtml(html);
    const lowerUrl = url.toLowerCase();
    const title =
      this.extractTitle(html) || 'White House reciprocal tariff policy update';

    const countryCode = this.inferCountryCodeFromUrlAndText(lowerUrl, text);
    if (!countryCode) {
      return [];
    }

    const rate = this.extractReciprocalRatePercent(text);
    if (rate == null) {
      return [];
    }

    return [
      {
        taxCode: `RECIP_FRAMEWORK_${countryCode}`,
        taxName: `Reciprocal Tariff Framework (${countryCode})`,
        description:
          'Country framework reciprocal tariff rate announced by the White House; requires HTS Annex applicability filtering.',
        countryCode,
        extraRateType: 'CONDITIONAL',
        ratePercent: rate,
        rateText: `${rate}% ad valorem`,
        rateFormula: `value * ${(rate / 100).toFixed(4)}`,
        htsNumber: '*',
        htsChapter: '99',
        effectiveDate: null,
        expirationDate: null,
        legalReference:
          'White House presidential action / fact sheet on reciprocal tariff framework',
        notes:
          'Framework rate captured for admin policy monitoring. Validate Annex-specific exclusions before direct calculation use.',
        conditions: {
          requiresAnnexMapping: true,
          frameworkRateOnly: true,
        },
        priority: 8,
        sourceUrl: url,
        sourceTitle: title,
        sourceType: 'WHITE_HOUSE',
      },
    ];
  }

  private async extractPoliciesWithAiWebSearch(): Promise<
    ReciprocalPolicyCandidate[]
  > {
    if (!process.env.OPENAI_API_KEY) {
      return [];
    }

    try {
      const openAiService = new OpenAiService();
      const prompt = [
        'Find current U.S. reciprocal tariff framework rates using only official U.S. government sources.',
        'Prefer CBP, Federal Register, White House, USTR, and USITC pages.',
        'Return country-level reciprocal tariff percentages where explicitly stated.',
        'Ignore non-official domains and speculation.',
      ].join('\n');

      const response = await openAiService.response(prompt, {
        model: 'gpt-4o-mini',
        temperature: 0,
        max_output_tokens: 1400,
        tools: [{ type: 'web_search_preview' }] as any,
        text: {
          format: {
            type: 'json_schema',
            name: 'reciprocal_tariff_official_rates',
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['policies'],
              properties: {
                policies: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: [
                      'countryCode',
                      'ratePercent',
                      'sourceUrl',
                      'summary',
                    ],
                    properties: {
                      countryCode: { type: 'string' },
                      ratePercent: { type: 'number' },
                      effectiveDate: { type: ['string', 'null'] },
                      sourceUrl: { type: 'string' },
                      summary: { type: 'string' },
                    },
                  },
                },
              },
            },
            strict: true,
          },
        },
      });

      const raw = (response as any)?.output_text || '';
      const parsed = raw ? JSON.parse(raw) : null;
      if (!parsed || !Array.isArray(parsed.policies)) {
        return [];
      }

      const output: ReciprocalPolicyCandidate[] = [];
      for (const policy of parsed.policies) {
        const countryCode = String(policy.countryCode || '')
          .trim()
          .toUpperCase();
        const ratePercent = Number(policy.ratePercent);
        const sourceUrl = String(policy.sourceUrl || '').trim();
        const summary = String(policy.summary || '').trim();

        if (!countryCode || !Number.isFinite(ratePercent) || !sourceUrl) {
          continue;
        }
        if (
          !/\.gov\//i.test(sourceUrl) &&
          !/whitehouse\.gov/i.test(sourceUrl)
        ) {
          continue;
        }

        output.push({
          taxCode: `RECIP_AI_${countryCode}`,
          taxName: `Reciprocal Tariff (AI verified official) ${countryCode}`,
          description:
            'AI-assisted deep search extraction from official U.S. government source(s).',
          countryCode,
          extraRateType: 'CONDITIONAL',
          ratePercent,
          rateText: `${ratePercent}% ad valorem`,
          rateFormula: `value * ${(ratePercent / 100).toFixed(4)}`,
          htsNumber: '*',
          htsChapter: '99',
          effectiveDate: policy.effectiveDate
            ? String(policy.effectiveDate)
            : null,
          expirationDate: null,
          legalReference:
            'AI deep search over official U.S. government sources',
          notes: summary,
          conditions: {
            aiAssisted: true,
            requiresManualReview: true,
          },
          priority: 6,
          sourceUrl,
          sourceTitle: 'AI web search synthesis (official .gov only)',
          sourceType: 'AI_WEB_SEARCH',
        });
      }

      return output;
    } catch (error: any) {
      this.logger.warn(
        `AI deep-search reciprocal extraction failed: ${error?.message || 'unknown error'}`,
      );
      return [];
    }
  }

  private dedupeCandidates(
    candidates: ReciprocalPolicyCandidate[],
  ): ReciprocalPolicyCandidate[] {
    const map = new Map<string, ReciprocalPolicyCandidate>();
    for (const candidate of candidates) {
      const key = [
        candidate.taxCode,
        candidate.countryCode,
        candidate.htsNumber || '*',
        candidate.rateText,
        candidate.effectiveDate || 'NA',
      ].join('|');
      if (!map.has(key)) {
        map.set(key, candidate);
      }
    }
    return Array.from(map.values());
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private extractTitle(html: string): string | null {
    const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (!match) return null;
    return this.stripHtml(match[1]);
  }

  private inferCountryCodeFromUrlAndText(
    url: string,
    text: string,
  ): string | null {
    const hints = Object.keys(this.countryNameToCode);
    for (const hint of hints) {
      if (
        url.includes(hint.replace(/\s+/g, '-')) ||
        text.toLowerCase().includes(hint)
      ) {
        return this.countryNameToCode[hint];
      }
    }
    return null;
  }

  private extractReciprocalRatePercent(text: string): number | null {
    const patterns = [
      /(\d+(?:\.\d+)?)\s*percent[^.]{0,100}reciprocal tariff/i,
      /reciprocal tariff[^.]{0,100}(\d+(?:\.\d+)?)\s*percent/i,
      /maintain(?:ed|ing)?\s+at\s+(\d+(?:\.\d+)?)\s*percent/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const parsed = Number(match[1]);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }
    return null;
  }

  private getMethodModelFromOfficialSources(): ReciprocalMethodReference {
    return {
      derivedFrom: [
        this.officialUrls.cbpFaq,
        this.officialUrls.federalRegisterDocuments[0],
        this.officialUrls.federalRegisterDocuments[
          this.officialUrls.federalRegisterDocuments.length - 1
        ],
      ],
      narrative:
        'Reciprocal tariffs are modeled as the tariff change needed to offset bilateral deficit via import reduction, accounting for elasticity and tariff passthrough.',
      // Inference from reference text because the equation line is not rendered in exported text.
      formulaInferred:
        'deltaTau_i = max(0, (m_i - x_i) / (|epsilon| * phi * m_i))',
      parameters: {
        epsilonAbsolute: 4,
        passthroughPhi: 0.25,
      },
      simplifiedEquivalent:
        'With epsilon=4 and phi=0.25, deltaTau_i simplifies to max(0, (m_i - x_i)/m_i).',
    };
  }

  private extractFederalRegisterDocumentNumber(url: string): string | null {
    const match = url.match(/\/(20\d{2}-\d{5})\//);
    return match ? match[1] : null;
  }

  private extractFederalRegisterPublicationDate(url: string): string | null {
    const match = url.match(/\/documents\/(\d{4})\/(\d{2})\/(\d{2})\//);
    if (!match) {
      return null;
    }
    return `${match[1]}-${match[2]}-${match[3]}`;
  }

  private parseDate(value: string | null): Date | null {
    if (!value) return null;
    // Use noon UTC for date-only policy fields to avoid timezone day-shift on persistence.
    const parsed = new Date(`${value}T12:00:00Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
}
