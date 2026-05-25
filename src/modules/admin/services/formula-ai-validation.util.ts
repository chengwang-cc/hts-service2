import { createHash } from 'crypto';
import type { z } from 'zod';
import {
  FormulaExtractorOutputSchema,
  FormulaJudgeOutputSchema,
} from './formula-ai-validation.schemas';
import type {
  FormulaExtractorOutput,
  FormulaJudgeOutput,
  JsonRecord,
  JsonValue,
} from './formula-ai-validation.schemas';

export interface ParsedAssistantJson<T> {
  sanitizedOutput: string;
  parsed: T | null;
  validationErrors: string[];
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function sanitizeAssistantJson(rawOutput: string): string {
  const withoutReasoning = rawOutput
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  const firstBrace = withoutReasoning.indexOf('{');
  const lastBrace = withoutReasoning.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return withoutReasoning.slice(firstBrace, lastBrace + 1).trim();
  }
  return withoutReasoning;
}

export function parseExtractorOutput(
  rawOutput: string,
): ParsedAssistantJson<FormulaExtractorOutput> {
  return parseAssistantJsonWithSchema(rawOutput, FormulaExtractorOutputSchema);
}

export function parseJudgeOutput(
  rawOutput: string,
): ParsedAssistantJson<FormulaJudgeOutput> {
  return parseAssistantJsonWithSchema(rawOutput, FormulaJudgeOutputSchema);
}

function parseAssistantJsonWithSchema<T>(
  rawOutput: string,
  schema: z.ZodType<T>,
): ParsedAssistantJson<T> {
  const sanitizedOutput = sanitizeAssistantJson(rawOutput);
  try {
    const parsed = JSON.parse(sanitizedOutput) as unknown;
    const validation = schema.safeParse(parsed);
    if (!validation.success) {
      return {
        sanitizedOutput,
        parsed: null,
        validationErrors: validation.error.issues.map(
          (issue) => `${issue.path.map(String).join('.')}: ${issue.message}`,
        ),
      };
    }
    return {
      sanitizedOutput,
      parsed: validation.data,
      validationErrors: [],
    };
  } catch (error) {
    return {
      sanitizedOutput,
      parsed: null,
      validationErrors: [
        error instanceof Error ? error.message : 'Invalid JSON output',
      ],
    };
  }
}

export function toJsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => toJsonValue(item));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        toJsonValue(item),
      ]),
    );
  }
  return String(value);
}

export function toJsonRecord(value: unknown): JsonRecord {
  const converted = toJsonValue(value);
  return converted && typeof converted === 'object' && !Array.isArray(converted)
    ? (converted as JsonRecord)
    : {};
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortJson(item));
  }
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortJson(item)]),
    );
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
}
