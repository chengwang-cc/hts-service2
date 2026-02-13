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
      return { formula: '0', variables: [], confidence: 1.0, method: 'pattern' };
    }

    const normalized = rateText.trim().toLowerCase();

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
   * Try pattern matching for common rate formats
   */
  private tryPatternMatching(
    rateText: string,
    unitOfQuantity?: string,
  ): { formula: string; variables: string[]; confidence: number } | null {
    // Free/No duty
    if (/^(free|none|0%?)$/.test(rateText)) {
      return { formula: '0', variables: [], confidence: 1.0 };
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

    // Specific duty with currency: "$2.50/kg", "25¢/kg", "$0.50 per kg"
    const specificMatch = rateText.match(
      /^(?:\$|¢)?\s*(\d+(?:\.\d+)?)\s*(?:¢|cents?)?\s*(?:\/|per)\s*(\w+)$/,
    );
    if (specificMatch) {
      let amount = parseFloat(specificMatch[1]);
      const unit = specificMatch[2].toLowerCase();

      // Convert cents to dollars
      if (rateText.includes('¢') || rateText.includes('cent')) {
        amount = amount / 100;
      }

      // Map unit to variable
      const variable = this.mapUnitToVariable(unit, unitOfQuantity);

      return {
        formula: `${variable} * ${amount}`,
        variables: [variable],
        confidence: 0.9,
      };
    }

    // Compound rate: "5% + 25¢/kg", "10% + $2/kg"
    const compoundMatch = rateText.match(
      /^(\d+(?:\.\d+)?)\s*%\s*\+\s*(?:\$|¢)?\s*(\d+(?:\.\d+)?)\s*(?:¢|cents?)?\s*(?:\/|per)\s*(\w+)$/,
    );
    if (compoundMatch) {
      const adValoremRate = parseFloat(compoundMatch[1]) / 100;
      let specificAmount = parseFloat(compoundMatch[2]);
      const unit = compoundMatch[3].toLowerCase();

      // Convert cents to dollars
      if (rateText.includes('¢') || rateText.includes('cent')) {
        specificAmount = specificAmount / 100;
      }

      const variable = this.mapUnitToVariable(unit, unitOfQuantity);

      return {
        formula: `value * ${adValoremRate} + ${variable} * ${specificAmount}`,
        variables: ['value', variable],
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
      if (!result.formula || !result.variables || !result.confidence) {
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
  private mapUnitToVariable(unit: string, unitOfQuantity?: string): string {
    const normalized = unit.toLowerCase();

    // Weight-based units
    if (
      /^(kg|kgs|kilogram|kilograms|gram|grams|lb|lbs|pound|pounds|oz|ounce|ounces|ton|tons|tonne|tonnes)$/.test(
        normalized,
      )
    ) {
      return 'weight';
    }

    // Quantity-based units
    if (
      /^(ea|each|unit|units|piece|pieces|item|items|number|no|doz|dozen|pair|pairs|set|sets)$/.test(
        normalized,
      )
    ) {
      return 'quantity';
    }

    // Volume-based units
    if (
      /^(l|liter|liters|litre|litres|ml|milliliter|milliliters|gal|gallon|gallons|qt|quart|quarts)$/.test(
        normalized,
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
    if (unitOfQuantity && normalized.includes(unitOfQuantity.toLowerCase())) {
      return 'quantity';
    }

    // Default to weight for unknown units
    this.logger.warn(`Unknown unit: ${unit}, defaulting to weight`);
    return 'weight';
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

      const normalized = rate.rateText.trim().toLowerCase();
      const patternResult = this.tryPatternMatching(normalized, rate.unitOfQuantity);
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

      return results.map((result: any) => ({
        index: result.index,
        formula: result.formula,
        variables: result.variables,
        confidence: Math.max(0, Math.min(1, result.confidence - 0.1)),
      }));
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
