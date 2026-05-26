import { Injectable, Logger } from '@nestjs/common';
import { OpenAiService } from './openai.service';

// Identifiers recognised as mathjs builtins, not data variables. Anything
// referenced in a formula and not in this set is treated as a variable
// (e.g. value, weight, quantity, degree, count, ...).
const FORMULA_FUNCTION_NAMES = new Set<string>([
  'max',
  'min',
  'abs',
  'round',
  'ceil',
  'floor',
  'sqrt',
  'pow',
  'exp',
  'log',
  'log10',
  'mod',
  'sign',
  'true',
  'false',
  'pi',
  'e',
]);

/**
 * Formula Generation Service
 * Converts rate text (e.g., "5%", "$2.50/kg") into executable formulas
 */
@Injectable()
export class FormulaGenerationService {
  private readonly logger = new Logger(FormulaGenerationService.name);

  constructor(private readonly openAiService: OpenAiService) {}

  /**
   * Generate formula from rate text
   * Examples:
   * - "5%" → "value * 0.05"
   * - "$2.50/kg" → "weight * 2.50"
   * - "5% + 25¢/kg" → "value * 0.05 + weight * 0.25"
   * - "Free" → "0"
   */
  async generateFormula(
    rateText: string,
    unitOfQuantity?: string,
  ): Promise<{
    formula: string;
    variables: string[];
    confidence: number;
    method: 'pattern' | 'ai';
  }> {
    if (!rateText || rateText.trim() === '') {
      return {
        formula: '0',
        variables: [],
        confidence: 1.0,
        method: 'pattern',
      };
    }

    const normalized = this.normalizeRateText(rateText);

    // Try pattern matching first (fast, deterministic)
    const patternResult = this.tryPatternMatching(normalized, unitOfQuantity);
    if (patternResult) {
      return { ...patternResult, method: 'pattern' };
    }

    if (this.requiresManualReview(normalized)) {
      throw new Error('Ambiguous rate text requires manual review');
    }

    // Fall back to AI for complex rates
    this.logger.log(`Using AI to parse rate: ${rateText}`);
    const aiResult = await this.parseRateWithAI(rateText, unitOfQuantity);
    return { ...aiResult, method: 'ai' };
  }

  /**
   * Generate formula using deterministic pattern matching only.
   * Returns null for unsupported/ambiguous rate text.
   */
  generateFormulaByPattern(
    rateText: string,
    unitOfQuantity?: string,
  ): { formula: string; variables: string[]; confidence: number } | null {
    if (!rateText || rateText.trim() === '') {
      return { formula: '0', variables: [], confidence: 1.0 };
    }

    return this.tryPatternMatching(
      this.normalizeRateText(rateText),
      unitOfQuantity,
    );
  }

  /**
   * Try pattern matching for common rate formats
   */
  private tryPatternMatching(
    rateText: string,
    unitOfQuantity?: string,
  ): { formula: string; variables: string[]; confidence: number } | null {
    if (this.requiresManualReview(rateText)) {
      return null;
    }

    // Free/No duty
    if (/^(free|none|0%?)$/.test(rateText) || /^free\b/.test(rateText)) {
      return { formula: '0', variables: [], confidence: 1.0 };
    }

    // Explicit ad valorem: "5% ad valorem", "5 percent ad valorem"
    const percentageValuePattern =
      '((?:\\d+(?:\\.\\d+)?(?:\\s+\\d+\\/\\d+)?)|(?:\\d+\\/\\d+))';
    const adValoremMatch = rateText.match(
      new RegExp(
        `^${percentageValuePattern}\\s*(?:%|percent|per cent)\\s*(?:ad valorem)?$`,
      ),
    );
    if (adValoremMatch) {
      const rate = this.parsePercentText(adValoremMatch[1]);
      if (rate === null) {
        return null;
      }
      return {
        formula: `value * ${rate}`,
        variables: ['value'],
        confidence: 1.0,
      };
    }

    // Simple percentage: "5%", "5.5%", "0.5%"
    const percentMatch = rateText.match(
      new RegExp(`^${percentageValuePattern}\\s*%$`),
    );
    if (percentMatch) {
      const rate = this.parsePercentText(percentMatch[1]);
      if (rate === null) {
        return null;
      }
      return {
        formula: `value * ${rate}`,
        variables: ['value'],
        confidence: 1.0,
      };
    }

    // Compound with ad valorem + specific component:
    // "5% + 25¢/kg", "90 cents/pr. + 37.5%", "10.2 cents/kg + 2.8%"
    const compoundRate = this.tryParseCompoundRate(rateText, unitOfQuantity);
    if (compoundRate) {
      return compoundRate;
    }

    // Specific duty:
    // "$2.50/kg", "25¢/kg", "0.9 cents each", "2.8 cents/doz.", "3.7 cents/kg on drained weight"
    const specificComponent = this.parseSpecificComponent(
      rateText,
      unitOfQuantity,
    );
    if (specificComponent) {
      return {
        formula: `${specificComponent.variable} * ${specificComponent.amount}`,
        variables: [specificComponent.variable],
        confidence: 0.9,
      };
    }

    return null;
  }

  private requiresManualReview(rateText: string): boolean {
    const text = rateText.toLowerCase();
    return (
      /\b(see|note|quota|whichever|not less|not over|but not over|in lieu|except as provided)\b/.test(
        text,
      ) || /^\d+(?:\.\d+)?\s*%\s*(?:-|to)\s*\d+(?:\.\d+)?\s*%$/.test(text)
    );
  }

  private tryParseCompoundRate(
    rateText: string,
    unitOfQuantity?: string,
  ): { formula: string; variables: string[]; confidence: number } | null {
    const parts = rateText
      .split(/\s*\+\s*/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length < 2 || parts.length > 3) {
      return null;
    }
    if (this.hasAmbiguousComponentContext(rateText)) {
      return null;
    }

    const percentComponents = parts
      .map((part, index) => ({
        index,
        rate: this.parsePercentComponent(part),
      }))
      .filter((entry) => entry.rate !== null) as Array<{
      index: number;
      rate: number;
    }>;
    if (percentComponents.length > 1) {
      return null;
    }
    const hasAdValorem = percentComponents.length === 1;
    const adValoremRate = percentComponents[0]?.rate ?? null;
    const specificComponents = parts
      .map((part, index) => ({ part, index }))
      .filter(
        (entry) => !hasAdValorem || entry.index !== percentComponents[0].index,
      )
      .map((entry) => this.parseSpecificComponent(entry.part, unitOfQuantity))
      .filter(
        (entry): entry is { variable: string; amount: number } => !!entry,
      );

    if (specificComponents.length !== parts.length - (hasAdValorem ? 1 : 0)) {
      return null;
    }

    const additiveTerms = specificComponents.map(
      (component) => `${component.variable} * ${component.amount}`,
    );
    const variables = Array.from(
      new Set([
        ...(hasAdValorem ? ['value'] : []),
        ...specificComponents.map((component) => component.variable),
      ]),
    );

    return {
      formula: [
        ...(hasAdValorem ? [`value * ${adValoremRate}`] : []),
        ...additiveTerms,
      ].join(' + '),
      variables,
      confidence: 0.9,
    };
  }

  private parsePercentComponent(rateText: string): number | null {
    const match = rateText.match(
      /^((?:\d+(?:\.\d+)?(?:\s+\d+\/\d+)?)|(?:\d+\/\d+))\s*(?:%|percent|per cent)\s*(?:ad valorem)?(?:\s+on\s+the\s+entire\s+(?:set|article|item))?$/,
    );
    if (!match) {
      return null;
    }
    return this.parsePercentText(match[1]);
  }

  private parsePercentText(percentText: string): number | null {
    const text = percentText.trim();
    const mixed = text.match(/^(\d+(?:\.\d+)?)\s+(\d+)\/(\d+)$/);
    if (mixed) {
      const whole = parseFloat(mixed[1]);
      const numerator = parseFloat(mixed[2]);
      const denominator = parseFloat(mixed[3]);
      if (denominator <= 0) return null;
      return this.normalizeFormulaNumber(
        (whole + numerator / denominator) / 100,
      );
    }

    const fraction = text.match(/^(\d+)\/(\d+)$/);
    if (fraction) {
      const numerator = parseFloat(fraction[1]);
      const denominator = parseFloat(fraction[2]);
      if (denominator <= 0) return null;
      return this.normalizeFormulaNumber(numerator / denominator / 100);
    }

    if (/^\d+(?:\.\d+)?$/.test(text)) {
      return this.normalizeFormulaNumber(parseFloat(text) / 100);
    }

    return null;
  }

  private parseSpecificComponent(
    rateText: string,
    unitOfQuantity?: string,
  ): { variable: string; amount: number } | null {
    // Example: "0.9 cents each", "90 cents/pr.", "$2.50/kg", "3.7 cents/kg on drained weight"
    const eachStyleMatch = rateText.match(
      /^([$¢])?\s*(\d+(?:\.\d+)?)\s*(¢|cents?)?\s*(each|ea|item|items|article|articles|unit|units|piece|pieces|pr\.?|pair|pairs|doz\.?|dozen)(?:\s+(?:on|of|for)\b.*)?$/,
    );
    if (eachStyleMatch) {
      const amount = this.normalizeSpecificAmount(
        eachStyleMatch[1] || null,
        eachStyleMatch[2],
        eachStyleMatch[3] || null,
      );
      const variable = this.mapUnitToVariable(
        eachStyleMatch[4],
        unitOfQuantity,
      );
      if (!variable) {
        return null;
      }
      return { variable, amount };
    }

    const perUnitMatch = rateText.match(
      /^([$¢])?\s*(\d+(?:\.\d+)?)\s*(¢|cents?)?\s*(?:\/|per)\s*([a-z0-9.]+(?:\s+[a-z0-9.]+){0,2})(?:\s*(?:\/|per)\s*(\d+(?:\.\d+)?))?(?:\b|$)(?:\s*(?:,|(?:on|of|for)\b).*)?$/,
    );
    if (!perUnitMatch) {
      return null;
    }

    let amount = this.normalizeSpecificAmount(
      perUnitMatch[1] || null,
      perUnitMatch[2],
      perUnitMatch[3] || null,
    );
    const token = (perUnitMatch[4] || '').trim();
    const token2 = (perUnitMatch[5] || '').trim();

    // Support rates like "89.6 cents/1000" and "$1.34/1000" (implicit quantity denominator)
    if (/^\d+(?:\.\d+)?$/.test(token)) {
      const denominator = parseFloat(token);
      if (Number.isFinite(denominator) && denominator > 0) {
        amount = this.normalizeFormulaNumber(amount / denominator);
      }

      const inferredUnit = (unitOfQuantity || '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
      const inferredVariable =
        inferredUnit.length > 0
          ? this.mapUnitToVariable(inferredUnit, unitOfQuantity)
          : null;
      if (!inferredVariable) {
        return null;
      }
      const variable = inferredVariable;
      return { variable, amount };
    }

    let denominator: number | null = null;
    if (/^\d+(?:\.\d+)?$/.test(token2)) {
      const parsedDenominator = parseFloat(token2);
      if (Number.isFinite(parsedDenominator) && parsedDenominator > 0) {
        denominator = parsedDenominator;
      }
    }
    if (denominator !== null) {
      amount = this.normalizeFormulaNumber(amount / denominator);
    }

    const variable = this.mapUnitToVariable(token, unitOfQuantity);
    if (!variable) {
      return null;
    }
    return { variable, amount };
  }

  private hasAmbiguousComponentContext(rateText: string): boolean {
    return /\b(case|strap|band|bracelet|battery|movement|jewel|lead content)\b/.test(
      rateText,
    );
  }

  private normalizeSpecificAmount(
    prefixSymbol: string | null,
    amountText: string,
    suffixUnit: string | null,
  ): number {
    let amount = parseFloat(amountText);
    const isCents = prefixSymbol === '¢' || !!suffixUnit;
    if (isCents) {
      amount = amount / 100;
    }
    return this.normalizeFormulaNumber(amount);
  }

  private normalizeFormulaNumber(value: number): number {
    return Number(value.toPrecision(12));
  }

  private normalizeRateText(rateText: string): string {
    return rateText
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/ad val\./g, 'ad valorem')
      .replace(/per\s+cent/g, 'percent')
      .replace(/kgs?\b/g, 'kg')
      .replace(/\bno\.\b/g, 'number');
  }

  /**
   * Parse rate text using OpenAI for complex cases
   */
  private async parseRateWithAI(
    rateText: string,
    unitOfQuantity?: string,
  ): Promise<{ formula: string; variables: string[]; confidence: number }> {
    const prompt = `
Convert this customs duty rate into a mathematical formula:

Rate: "${rateText}"
Unit of Quantity: ${unitOfQuantity || 'Not specified'}

Available variables:
- value: The declared value of the goods (in dollars)
- weight: Weight in kg
- quantity_each: Number of individual items
- quantity_pair: Number of pairs
- quantity_dozen: Number of dozens
- quantity_set: Number of sets
- quantity_gross: Number of gross units
- volume_liter: Volume in liters
- proof_liter: Alcohol proof liters
- volume_barrel: Volume in barrels
- volume_m3: Volume in cubic meters
- weight_ton: Weight in metric tons
- area_m2: Area in square meters
- length_m: Length in meters

Rules:
1. Use mathematical operators: *, +, -, /, ()
2. For percentages, convert to decimal (5% → 0.05)
3. For specific duties, use the appropriate variable
4. For compound rates, combine with +
5. Return 0 for "Free" or no duty
6. Do not estimate ranges, quota language, note references, or minimum/maximum language. Those require manual review.

Return JSON only:
{
  "formula": "mathematical formula using variables",
  "variables": ["list", "of", "variables", "used"],
  "confidence": 0.0-1.0,
  "explanation": "brief explanation"
}

Examples:
- "5%" → {"formula": "value * 0.05", "variables": ["value"], "confidence": 1.0}
- "$2.50/kg" → {"formula": "weight * 2.50", "variables": ["weight"], "confidence": 1.0}
- "5% + 25¢/kg" → {"formula": "value * 0.05 + weight * 0.25", "variables": ["value", "weight"], "confidence": 1.0}
`;

    try {
      const response = await this.openAiService.response(prompt, {
        model: 'gpt-5.4-mini',
        temperature: 0.1,
        max_output_tokens: 200,
        store: false,
        text: {
          format: {
            type: 'json_schema',
            json_schema: {
              name: 'formula_response',
              schema: {
                type: 'object',
                properties: {
                  formula: { type: 'string' },
                  variables: { type: 'array', items: { type: 'string' } },
                  confidence: { type: 'number' },
                  explanation: { type: 'string' },
                },
                // OpenAI strict json_schema mode requires that `required`
                // contains EVERY key in `properties`. The live run failure
                // (Missing 'explanation') happened because we listed
                // explanation as a property but left it out of required.
                required: ['formula', 'variables', 'confidence', 'explanation'],
                additionalProperties: false,
              },
              strict: true,
            },
          },
        },
      });

      const outputText = (response as any).output_text || '';
      const result = JSON.parse(outputText);

      // Validate response
      const hasValidFormula =
        typeof result.formula === 'string' && result.formula.trim().length > 0;
      const hasValidVariables = Array.isArray(result.variables);
      const hasValidConfidence =
        typeof result.confidence === 'number' &&
        Number.isFinite(result.confidence) &&
        result.confidence >= 0 &&
        result.confidence <= 1;

      if (!hasValidFormula || !hasValidVariables || !hasValidConfidence) {
        throw new Error('Invalid AI response format');
      }
      const formulaValidation = this.validateFormula(result.formula);
      if (!formulaValidation.valid) {
        throw new Error(
          `AI returned invalid formula: ${formulaValidation.error}`,
        );
      }
      const variables = this.mergeAiVariables(
        result.variables,
        formulaValidation.variables,
      );

      return {
        formula: result.formula,
        variables,
        confidence: Math.max(0, Math.min(1, result.confidence - 0.1)), // Reduce confidence for AI
      };
    } catch (error) {
      this.logger.error(`AI formula generation failed: ${error.message}`);

      throw new Error('AI formula generation failed');
    }
  }

  /**
   * Map unit to variable name
   */
  private mapUnitToVariable(
    unit: string,
    unitOfQuantity?: string,
  ): string | null {
    const normalized = unit.toLowerCase().trim();
    const normalizedWithoutQualifiers = normalized
      .replace(/\b(clean|net|gross|drained|proof|pf\.?)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const compact = normalized.replace(/[^a-z0-9]/g, '');
    const compactWithoutQualifiers = normalizedWithoutQualifiers.replace(
      /[^a-z0-9]/g,
      '',
    );

    // Weight-based units
    if (
      /^(kg|kgs|kilogram|kilograms|gram|grams|lb|lbs|pound|pounds|oz|ounce|ounces)$/.test(
        normalized,
      ) ||
      /^(kg|kgs|kilogram|kilograms|gram|grams|lb|lbs|pound|pounds|oz|ounce|ounces)$/.test(
        compact,
      ) ||
      /^(kg|kgs|kilogram|kilograms|gram|grams|lb|lbs|pound|pounds|oz|ounce|ounces)$/.test(
        normalizedWithoutQualifiers,
      ) ||
      /^(kg|kgs|kilogram|kilograms|gram|grams|lb|lbs|pound|pounds|oz|ounce|ounces)$/.test(
        compactWithoutQualifiers,
      )
    ) {
      return 'weight';
    }

    if (
      /^(t|ton|tons|tonne|tonnes|metric ton|metric tons)$/.test(normalized) ||
      /^(t|ton|tons|tonne|tonnes|metricton|metrictons)$/.test(compact) ||
      /^(t|ton|tons|tonne|tonnes|metric ton|metric tons)$/.test(
        normalizedWithoutQualifiers,
      ) ||
      /^(t|ton|tons|tonne|tonnes|metricton|metrictons)$/.test(
        compactWithoutQualifiers,
      )
    ) {
      return 'weight_ton';
    }

    const quantityVariable =
      this.mapQuantityUnit(normalized) ||
      this.mapQuantityUnit(compact) ||
      this.mapQuantityUnit(normalizedWithoutQualifiers) ||
      this.mapQuantityUnit(compactWithoutQualifiers);
    if (quantityVariable) {
      return quantityVariable;
    }

    // Volume-based units
    if (
      /^(l|liter|liters|litre|litres|ml|milliliter|milliliters|gal|gallon|gallons|qt|quart|quarts)$/.test(
        normalized,
      ) ||
      /^(l|liter|liters|litre|litres|ml|milliliter|milliliters|gal|gallon|gallons|qt|quart|quarts|proofliter|proofliters|pfliter|pfliters)$/.test(
        compact,
      ) ||
      /^(l|liter|liters|litre|litres|ml|milliliter|milliliters|gal|gallon|gallons|qt|quart|quarts)$/.test(
        normalizedWithoutQualifiers,
      ) ||
      /^(l|liter|liters|litre|litres|ml|milliliter|milliliters|gal|gallon|gallons|qt|quart|quarts|proofliter|proofliters|pfliter|pfliters)$/.test(
        compactWithoutQualifiers,
      )
    ) {
      if (
        /proof\s*l/i.test(normalized) ||
        /^(proofliter|proofliters|pfliter|pfliters)$/.test(compact)
      ) {
        return 'proof_liter';
      }
      return 'volume_liter';
    }

    if (
      /^(bbl|barrel|barrels)$/.test(normalized) ||
      /^(bbl|barrel|barrels)$/.test(compact)
    ) {
      return 'volume_barrel';
    }

    if (
      /^(m3|cbm|cubic meter|cubic meters|cubic metre|cubic metres)$/.test(
        normalized,
      ) ||
      /^(m3|cbm|cubicmeter|cubicmeters|cubicmetre|cubicmetres)$/.test(compact)
    ) {
      return 'volume_m3';
    }

    // Area-based units
    if (
      /^(sqm|m2|square meter|square meters|sqft|square foot|square feet)$/.test(
        normalized,
      )
    ) {
      return 'area_m2';
    }

    // Length-based units
    if (
      /^(m|meter|meters|cm|centimeter|centimeters|mm|millimeter|millimeters|ft|foot|feet|in|inch|inches|yd|yard|yards)$/.test(
        normalized,
      )
    ) {
      return 'length_m';
    }

    // Accept an inferred source unit only when it maps to a known dimension.
    if (
      unitOfQuantity &&
      (compact.includes(
        unitOfQuantity.toLowerCase().replace(/[^a-z0-9]/g, ''),
      ) ||
        compactWithoutQualifiers.includes(
          unitOfQuantity.toLowerCase().replace(/[^a-z0-9]/g, ''),
        ))
    ) {
      const sourceUnit = unitOfQuantity.toLowerCase().replace(/[^a-z0-9]/g, '');
      return this.mapQuantityUnit(sourceUnit);
    }

    this.logger.warn(
      `Unknown unit: ${unit}, unable to map to formula variable`,
    );
    return null;
  }

  private mapQuantityUnit(unit: string): string | null {
    if (
      /^(ea|each|head|heads|unit|units|piece|pieces|item|items|article|articles|number|no)$/.test(
        unit,
      )
    ) {
      return 'quantity_each';
    }
    if (/^(doz|dozen)$/.test(unit)) return 'quantity_dozen';
    if (/^(pair|pairs|pr)$/.test(unit)) return 'quantity_pair';
    if (/^(set|sets)$/.test(unit)) return 'quantity_set';
    if (/^(gross)$/.test(unit)) return 'quantity_gross';
    if (/^(cent)$/.test(unit)) return 'quantity_each';
    return null;
  }

  /**
   * Batch generate formulas for multiple rates
   */
  async generateFormulaBatch(
    rates: Array<{ rateText: string; unitOfQuantity?: string }>,
  ): Promise<
    Array<{
      formula: string;
      variables: string[];
      confidence: number;
      method: 'pattern' | 'ai';
    }>
  > {
    const results: Array<{
      formula: string;
      variables: string[];
      confidence: number;
      method: 'pattern' | 'ai';
    }> = new Array(rates.length);

    const aiCandidates: Array<{
      index: number;
      rateText: string;
      unitOfQuantity?: string;
    }> = [];
    const manualReviewRates: string[] = [];

    // First pass: try pattern matching for all entries
    rates.forEach((rate, index) => {
      if (!rate.rateText || rate.rateText.trim() === '') {
        results[index] = {
          formula: '0',
          variables: [],
          confidence: 1.0,
          method: 'pattern',
        };
        return;
      }

      const normalized = this.normalizeRateText(rate.rateText);
      const patternResult = this.tryPatternMatching(
        normalized,
        rate.unitOfQuantity,
      );
      if (patternResult) {
        results[index] = { ...patternResult, method: 'pattern' };
      } else if (this.requiresManualReview(normalized)) {
        manualReviewRates.push(rate.rateText);
      } else {
        aiCandidates.push({
          index,
          rateText: rate.rateText,
          unitOfQuantity: rate.unitOfQuantity,
        });
      }
    });

    if (manualReviewRates.length > 0) {
      throw new Error(
        `Ambiguous rate text requires manual review: ${manualReviewRates
          .slice(0, 5)
          .join('; ')}`,
      );
    }

    // Second pass: batch AI for unresolved entries (100 per batch)
    const batchSize = 100;
    for (let i = 0; i < aiCandidates.length; i += batchSize) {
      const batch = aiCandidates.slice(i, i + batchSize);
      const batchResults = await this.parseRatesWithAI(batch);

      for (const result of batchResults) {
        results[result.index] = {
          formula: result.formula,
          variables: result.variables,
          confidence: result.confidence,
          method: 'ai',
        };
      }
    }

    // Final fallback for any missing results
    for (let i = 0; i < results.length; i++) {
      if (!results[i]) {
        results[i] = await this.generateFormula(
          rates[i].rateText,
          rates[i].unitOfQuantity,
        );
      }
    }

    this.logger.log(
      `Generated ${results.length} formulas: ${results.filter((r) => r.method === 'pattern').length} by pattern, ${results.filter((r) => r.method === 'ai').length} by AI`,
    );

    return results;
  }

  /**
   * Batch parse rate text using OpenAI for complex cases
   * Uses structured JSON schema output to minimize parsing errors.
   */
  private async parseRatesWithAI(
    rates: Array<{ index: number; rateText: string; unitOfQuantity?: string }>,
  ): Promise<
    Array<{
      index: number;
      formula: string;
      variables: string[];
      confidence: number;
    }>
  > {
    if (rates.length === 0) return [];

    const promptLines = rates
      .map(
        (rate) =>
          `#${rate.index} | Rate: "${rate.rateText}" | Unit: ${rate.unitOfQuantity || 'Not specified'}`,
      )
      .join('\n');

    const prompt = `
Convert each customs duty rate into a mathematical formula.

Available variables:
- value: The declared value of the goods (in dollars)
- weight: Weight in kg
- quantity_each: Number of individual items
- quantity_pair: Number of pairs
- quantity_dozen: Number of dozens
- quantity_set: Number of sets
- quantity_gross: Number of gross units
- volume_liter: Volume in liters
- proof_liter: Alcohol proof liters
- volume_barrel: Volume in barrels
- volume_m3: Volume in cubic meters
- weight_ton: Weight in metric tons
- area_m2: Area in square meters
- length_m: Length in meters

Rules:
1. Use mathematical operators: *, +, -, /, ()
2. For percentages, convert to decimal (5% → 0.05)
3. For specific duties, use the appropriate variable
4. For compound rates, combine with +
5. Return 0 for "Free" or no duty
6. Do not estimate ranges, quota language, note references, or minimum/maximum language. Those require manual review.

Return JSON array only.

Items:
${promptLines}
`;

    try {
      const response = await this.openAiService.response(prompt, {
        model: 'gpt-5.4-mini',
        temperature: 0.1,
        max_output_tokens: 1200,
        store: false,
        text: {
          format: {
            type: 'json_schema',
            json_schema: {
              name: 'formula_batch_response',
              schema: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    index: { type: 'number' },
                    formula: { type: 'string' },
                    variables: { type: 'array', items: { type: 'string' } },
                    confidence: { type: 'number' },
                  },
                  required: ['index', 'formula', 'variables', 'confidence'],
                  additionalProperties: false,
                },
              },
              strict: true,
            },
          },
        },
      });

      const outputText = (response as any).output_text || '';
      if (!outputText) {
        throw new Error('OpenAI returned empty response');
      }

      const results = JSON.parse(outputText);
      if (!Array.isArray(results)) {
        throw new Error('Invalid AI batch response format');
      }

      const normalized = results
        .filter((result: any) => {
          const hasValidIndex =
            typeof result.index === 'number' &&
            Number.isInteger(result.index) &&
            result.index >= 0;
          const hasValidFormula =
            typeof result.formula === 'string' &&
            result.formula.trim().length > 0;
          const hasValidVariables = Array.isArray(result.variables);
          const hasValidConfidence =
            typeof result.confidence === 'number' &&
            Number.isFinite(result.confidence) &&
            result.confidence >= 0 &&
            result.confidence <= 1;
          return (
            hasValidIndex &&
            hasValidFormula &&
            hasValidVariables &&
            hasValidConfidence
          );
        })
        .map((result: any) => {
          const validation = this.validateFormula(result.formula);
          if (!validation.valid) {
            return null;
          }
          return {
            index: result.index,
            formula: result.formula,
            variables: this.mergeAiVariables(
              result.variables,
              validation.variables,
            ),
            confidence: Math.max(0, Math.min(1, result.confidence - 0.1)),
          };
        })
        .filter(
          (
            result,
          ): result is {
            index: number;
            formula: string;
            variables: string[];
            confidence: number;
          } => !!result,
        );

      return normalized;
    } catch (error) {
      this.logger.error(`AI batch formula generation failed: ${error.message}`);
      return [];
    }
  }

  private mergeAiVariables(
    declared: unknown[],
    referenced: string[],
  ): string[] {
    const out = new Set<string>();
    for (const value of declared || []) {
      if (typeof value === 'string' && value.trim()) {
        out.add(value.trim());
      }
    }
    for (const value of referenced || []) {
      if (value && value.trim()) {
        out.add(value.trim());
      }
    }
    return Array.from(out);
  }

  /**
   * Validate formula syntax
   */
  validateFormula(formula: string): {
    valid: boolean;
    error?: string;
    variables: string[];
  } {
    try {
      // Extract variables from formula
      const variables = this.extractVariables(formula);

      // Check for dangerous patterns
      if (
        /eval|function|=>|require|import|export|async|await|process|global|window/.test(
          formula,
        )
      ) {
        return {
          valid: false,
          error: 'Formula contains forbidden keywords',
          variables: [],
        };
      }

      // Allowed characters: digits, whitespace, basic arithmetic + parentheses,
      // identifiers (a-z_), and the operators needed by mathjs expressions that
      // tariff sources actually use:
      //   ,        function call arguments — e.g. max(a, b), min(a, b)
      //   < > = !  comparisons — e.g. weight > 100, value == 0
      //   ? :      ternary — e.g. weight > 100 ? a : b
      //   ^ %      exponent and modulo
      // The keyword blocklist above already rejects code-construct strings
      // (eval, function, =>, require, …) so widening the char set is safe.
      if (!/^[\d\s+\-*/().,a-z_<>=!?:^%]+$/i.test(formula)) {
        return {
          valid: false,
          error: 'Formula contains invalid characters',
          variables: [],
        };
      }

      return { valid: true, variables };
    } catch (error) {
      return { valid: false, error: error.message, variables: [] };
    }
  }

  /**
   * Extract variable names from formula. Matches any identifier and strips
   * mathjs function names so callers receive only data variables.
   */
  private extractVariables(formula: string): string[] {
    const variables = new Set<string>();
    const matches = formula.matchAll(/\b[a-z_][a-z0-9_]*\b/gi);

    for (const match of matches) {
      const name = match[0];
      if (FORMULA_FUNCTION_NAMES.has(name)) continue;
      variables.add(name);
    }

    return Array.from(variables);
  }
}
