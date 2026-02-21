import { Injectable, Logger } from '@nestjs/common';
import { OpenAiService } from './openai.service';

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
    // Free/No duty
    if (/^(free|none|0%?)$/.test(rateText) || /^free\b/.test(rateText)) {
      return { formula: '0', variables: [], confidence: 1.0 };
    }

    // Explicit ad valorem: "5% ad valorem", "5 percent ad valorem"
    const adValoremMatch = rateText.match(
      /^(\d+(?:\.\d+)?)\s*(?:%|percent|per cent)\s*(?:ad valorem)?$/,
    );
    if (adValoremMatch) {
      const rate = parseFloat(adValoremMatch[1]) / 100;
      return {
        formula: `value * ${rate}`,
        variables: ['value'],
        confidence: 1.0,
      };
    }

    // Simple percentage: "5%", "5.5%", "0.5%"
    const percentMatch = rateText.match(/^(\d+(?:\.\d+)?)\s*%$/);
    if (percentMatch) {
      const rate = parseFloat(percentMatch[1]) / 100;
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

    // Range: "5%-10%", "5% to 10%"
    const rangeMatch = rateText.match(
      /^(\d+(?:\.\d+)?)\s*%\s*(?:-|to)\s*(\d+(?:\.\d+)?)\s*%$/,
    );
    if (rangeMatch) {
      const minRate = parseFloat(rangeMatch[1]) / 100;
      return {
        formula: `value * ${minRate}`,
        variables: ['value'],
        confidence: 0.7,
      };
    }

    return null;
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
    if (percentComponents.length !== 1) {
      return null;
    }
    const adValoremRate = percentComponents[0].rate;
    const specificComponents = parts
      .map((part, index) => ({ part, index }))
      .filter((entry) => entry.index !== percentComponents[0].index)
      .map((entry) => this.parseSpecificComponent(entry.part, unitOfQuantity))
      .filter(
        (entry): entry is { variable: string; amount: number } => !!entry,
      );

    if (specificComponents.length !== parts.length - 1) {
      return null;
    }

    const additiveTerms = specificComponents.map(
      (component) => `${component.variable} * ${component.amount}`,
    );
    const variables = Array.from(
      new Set([
        'value',
        ...specificComponents.map((component) => component.variable),
      ]),
    );

    return {
      formula: `value * ${adValoremRate} + ${additiveTerms.join(' + ')}`,
      variables,
      confidence: 0.9,
    };
  }

  private parsePercentComponent(rateText: string): number | null {
    const match = rateText.match(
      /^(\d+(?:\.\d+)?)\s*(?:%|percent|per cent)\s*(?:ad valorem)?(?:\s+on\s+the\s+entire\s+(?:set|article|item))?$/,
    );
    if (!match) {
      return null;
    }
    return parseFloat(match[1]) / 100;
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
      const variable =
        this.mapUnitToVariable(eachStyleMatch[4], unitOfQuantity) || 'quantity';
      return { variable, amount };
    }

    const perUnitMatch = rateText.match(
      /^([$¢])?\s*(\d+(?:\.\d+)?)\s*(¢|cents?)?\s*(?:\/|per)\s*([a-z0-9.]+(?:\s+[a-z0-9.]+){0,2})(?:\s*(?:\/|per)\s*(\d+(?:\.\d+)?))?(?:\b|$)(?:\s+(?:on|of|for)\b.*)?$/,
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
        amount = amount / denominator;
      }

      const inferredUnit = (unitOfQuantity || '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
      const inferredVariable =
        inferredUnit.length > 0
          ? this.mapUnitToVariable(inferredUnit, unitOfQuantity)
          : null;
      const variable = inferredVariable || 'quantity';
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
      amount = amount / denominator;
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
    return amount;
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
- quantity: Number of items

Rules:
1. Use mathematical operators: *, +, -, /, ()
2. For percentages, convert to decimal (5% → 0.05)
3. For specific duties, use the appropriate variable
4. For compound rates, combine with +
5. Return 0 for "Free" or no duty
6. Use conservative estimate for ranges (lower value)

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
        model: 'gpt-5.2',
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
                required: ['formula', 'variables', 'confidence'],
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

      return {
        formula: result.formula,
        variables: result.variables,
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
      /^(kg|kgs|kilogram|kilograms|gram|grams|lb|lbs|pound|pounds|oz|ounce|ounces|ton|tons|tonne|tonnes)$/.test(
        normalized,
      ) ||
      /^(kg|kgs|kilogram|kilograms|gram|grams|lb|lbs|pound|pounds|oz|ounce|ounces|ton|tons|tonne|tonnes)$/.test(
        compact,
      ) ||
      /^(kg|kgs|kilogram|kilograms|gram|grams|lb|lbs|pound|pounds|oz|ounce|ounces|ton|tons|tonne|tonnes)$/.test(
        normalizedWithoutQualifiers,
      ) ||
      /^(kg|kgs|kilogram|kilograms|gram|grams|lb|lbs|pound|pounds|oz|ounce|ounces|ton|tons|tonne|tonnes)$/.test(
        compactWithoutQualifiers,
      )
    ) {
      return 'weight';
    }

    // Quantity-based units
    if (
      /^(ea|each|unit|units|piece|pieces|item|items|number|no|doz|dozen|pair|pairs|pr|set|sets|gross|cent)$/.test(
        normalized,
      ) ||
      /^(ea|each|unit|units|piece|pieces|item|items|number|no|doz|dozen|pair|pairs|pr|set|sets|gross|cent)$/.test(
        compact,
      ) ||
      /^(ea|each|unit|units|piece|pieces|item|items|article|articles|number|no|doz|dozen|pair|pairs|pr|set|sets|gross|cent)$/.test(
        normalizedWithoutQualifiers,
      ) ||
      /^(ea|each|unit|units|piece|pieces|item|items|article|articles|number|no|doz|dozen|pair|pairs|pr|set|sets|gross|cent)$/.test(
        compactWithoutQualifiers,
      )
    ) {
      return 'quantity';
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
      return 'quantity'; // Treat as quantity for now
    }

    // Area-based units
    if (
      /^(sqm|m2|square meter|square meters|sqft|square foot|square feet)$/.test(
        normalized,
      )
    ) {
      return 'quantity';
    }

    // Length-based units
    if (
      /^(m|meter|meters|cm|centimeter|centimeters|mm|millimeter|millimeters|ft|foot|feet|in|inch|inches|yd|yard|yards)$/.test(
        normalized,
      )
    ) {
      return 'quantity';
    }

    // Default to quantity if unitOfQuantity matches
    if (
      unitOfQuantity &&
      (compact.includes(
        unitOfQuantity.toLowerCase().replace(/[^a-z0-9]/g, ''),
      ) ||
        compactWithoutQualifiers.includes(
          unitOfQuantity.toLowerCase().replace(/[^a-z0-9]/g, ''),
        ))
    ) {
      return 'quantity';
    }

    this.logger.warn(
      `Unknown unit: ${unit}, unable to map to formula variable`,
    );
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
      } else {
        aiCandidates.push({
          index,
          rateText: rate.rateText,
          unitOfQuantity: rate.unitOfQuantity,
        });
      }
    });

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
- quantity: Number of items

Rules:
1. Use mathematical operators: *, +, -, /, ()
2. For percentages, convert to decimal (5% → 0.05)
3. For specific duties, use the appropriate variable
4. For compound rates, combine with +
5. Return 0 for "Free" or no duty
6. Use conservative estimate for ranges (lower value)

Return JSON array only.

Items:
${promptLines}
`;

    try {
      const response = await this.openAiService.response(prompt, {
        model: 'gpt-5.2',
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
        .map((result: any) => ({
          index: result.index,
          formula: result.formula,
          variables: result.variables,
          confidence: Math.max(0, Math.min(1, result.confidence - 0.1)),
        }));

      return normalized;
    } catch (error) {
      this.logger.error(`AI batch formula generation failed: ${error.message}`);
      return [];
    }
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

      // Check only allowed characters
      if (!/^[\d\s\+\-\*\/\(\)\.a-z_]+$/i.test(formula)) {
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
   * Extract variable names from formula
   */
  private extractVariables(formula: string): string[] {
    const variables = new Set<string>();
    const matches = formula.matchAll(/\b(value|weight|quantity)\b/g);

    for (const match of matches) {
      variables.add(match[1]);
    }

    return Array.from(variables);
  }
}
