import { Injectable } from '@nestjs/common';
import { spawn } from 'child_process';
import type {
  FormulaExtractorOutput,
  FormulaJudgeOutput,
  FormulaSourcePack,
  JsonRecord,
} from './formula-ai-validation.schemas';
import {
  formulaExtractorOutputJsonSchema,
  formulaJudgeOutputJsonSchema,
} from './formula-ai-validation.schemas';
import {
  parseExtractorOutput,
  parseJudgeOutput,
  sha256Hex,
  stableStringify,
  toJsonRecord,
} from './formula-ai-validation.util';

export type FormulaExtractorAgentRole = 'qwen_extractor' | 'codex_extractor';
export type FormulaAgentRunStatus = 'parsed' | 'invalid' | 'failed';

export interface FormulaAgentRunResult {
  agentRole: FormulaExtractorAgentRole;
  modelId: string;
  promptVersion: string;
  promptHash: string;
  rawOutput: string;
  sanitizedOutput: string;
  parsedArtifact: FormulaExtractorOutput | null;
  validationErrors: string[];
  latencyMs: number;
  status: FormulaAgentRunStatus;
  metadata: JsonRecord;
}

export interface FormulaJudgeRunInput {
  sourcePack: FormulaSourcePack;
  codexOutput: FormulaExtractorOutput | null;
  qwenOutput: FormulaExtractorOutput | null;
  comparison: JsonRecord;
  deterministicParserOutput?: JsonRecord | null;
  evidence?: JsonRecord | null;
  highRisk?: boolean;
}

export interface FormulaJudgeRunResult {
  agentRole: 'claude_judge';
  modelId: string;
  promptVersion: string;
  promptHash: string;
  rawOutput: string;
  sanitizedOutput: string;
  parsedArtifact: FormulaJudgeOutput | null;
  validationErrors: string[];
  latencyMs: number;
  status: FormulaAgentRunStatus;
  metadata: JsonRecord;
}

interface QwenChatResponse {
  model?: string;
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  usage?: Record<string, unknown>;
}

@Injectable()
export class FormulaExtractorPromptService {
  readonly promptVersion = 'formula-extractor-v1';

  buildExtractorPrompt(
    sourcePack: FormulaSourcePack,
    agentName: string,
  ): string {
    return [
      `You are the ${agentName} formula extraction agent for HTS duty formulas.`,
      'Extract a deterministic formula artifact from the immutable source pack.',
      'Return ONLY valid JSON matching the provided schema. No markdown, no prose, no chain-of-thought.',
      'If the source text is ambiguous, unsupported, note-derived, quota/range based, or missing required inputs, use verdict "needs_human_review" or "unsupported".',
      'Do not invent official language. Citations must refer to fields present in the source pack.',
      'Use formula variable "value" for customs value. Use explicit unit dimensions for quantity, weight, volume, area, length, or proof-liter formulas.',
      'For "Free", "0%", or no-duty rates, use verdict "no_duty" and a component with formulaText "0" when a formula-bearing rate exists.',
      'Always inspect chapter99Text, chapter99Candidates, and currentFormulaArtifact.chapter99. Chapter 99 adjustments, including Section 201, Section 232, Section 301, Section 122, Section 421, reciprocal/IEEPA, quota, safeguard, temporary duty suspension, retaliatory tariff, and other 99xx headings, must be represented as additionalDuty components when supported by the source pack.',
      'When a Chapter 99 candidate has programFamily, programAuthority, or chapter99Heading metadata, carry it into conditionAst, constraints, citations, or reasonCodes. Identify each supported Chapter 99 component by its own program family, not only Section 301, and preserve country, heading selection, quota, safeguard, and effective-date conditions.',
      'If Chapter 99 applicability is footnote-derived or requires entry-specific selection, do not mark the formula unsupported when a formula can be extracted. Return needs_human_review with needsJudge true, include the best-supported component formula, and record the uncertainty in blockers.',
      '',
      `Output JSON schema:\n${JSON.stringify(formulaExtractorOutputJsonSchema)}`,
      '',
      `Source pack:\n${stableStringify(sourcePack)}`,
    ].join('\n');
  }

  buildJsonRepairPrompt(args: {
    sourcePack: FormulaSourcePack;
    invalidOutput: string;
    validationErrors: string[];
  }): string {
    return [
      'Repair the previous formula extraction response.',
      'Return ONLY valid JSON matching the formula extractor schema. Do not add markdown or explanation.',
      `Validation errors: ${args.validationErrors.join('; ')}`,
      '',
      `Invalid response:\n${args.invalidOutput}`,
      '',
      `Source pack:\n${stableStringify(args.sourcePack)}`,
    ].join('\n');
  }

  buildJudgePrompt(input: FormulaJudgeRunInput): string {
    return [
      'You are the Claude judge for HTS formula validation disagreements.',
      'Judge only from the supplied immutable source pack, extractor outputs, deterministic parser output, and evidence.',
      'Return ONLY valid JSON matching the judge schema. No markdown, no prose, no chain-of-thought.',
      'If evidence is insufficient or source language is ambiguous, return needs_human_review or insufficient_evidence.',
      'Do not publish or approve. Select an artifact only when it is clearly supported by supplied source fields.',
      'Validate Chapter 99 components explicitly. Confirm whether 99xx candidates are Section 201, Section 232, Section 301, Section 122, Section 421, reciprocal/IEEPA, quota, safeguard, temporary duty suspension, retaliatory tariff, or another Chapter 99 program, and ensure supported Chapter 99 additional duties are not dropped from the selected artifact.',
      '',
      `Output JSON schema:\n${JSON.stringify(formulaJudgeOutputJsonSchema)}`,
      '',
      `Judge input:\n${stableStringify(input)}`,
    ].join('\n');
  }
}

@Injectable()
export class QwenFormulaExtractorService {
  constructor(private readonly prompts: FormulaExtractorPromptService) {}

  async extract(sourcePack: FormulaSourcePack): Promise<FormulaAgentRunResult> {
    const prompt = this.prompts.buildExtractorPrompt(sourcePack, 'Qwen');
    const first = await this.runPrompt(sourcePack, prompt, false);
    if (first.status === 'parsed') {
      return first;
    }
    const repairPrompt = this.prompts.buildJsonRepairPrompt({
      sourcePack,
      invalidOutput: first.sanitizedOutput || first.rawOutput,
      validationErrors: first.validationErrors,
    });
    return this.runPrompt(sourcePack, repairPrompt, true);
  }

  private async runPrompt(
    sourcePack: FormulaSourcePack,
    prompt: string,
    repairAttempt: boolean,
  ): Promise<FormulaAgentRunResult> {
    const started = Date.now();
    const modelId =
      process.env.FORMULA_QWEN_MODEL || 'Qwen/Qwen3.5-35B-A3B-FP8';
    const endpoint = (
      process.env.FORMULA_QWEN_BASE_URL || 'http://192.168.1.10:6080/v1'
    ).replace(/\/$/, '');
    const promptHash = sha256Hex(prompt);
    try {
      const response = await fetch(`${endpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${process.env.FORMULA_QWEN_API_KEY || 'local'}`,
        },
        signal: AbortSignal.timeout(
          Number(process.env.FORMULA_QWEN_TIMEOUT_MS || 120_000),
        ),
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
          temperature: 0.1,
          max_tokens: Number(process.env.FORMULA_QWEN_MAX_TOKENS || 2048),
          chat_template_kwargs: {
            enable_thinking:
              process.env.FORMULA_QWEN_DISABLE_THINKING !== 'false'
                ? false
                : undefined,
          },
        }),
      });
      if (!response.ok) {
        throw new Error(`Qwen returned HTTP ${response.status}`);
      }
      const payload = (await response.json()) as QwenChatResponse;
      const rawOutput = payload.choices?.[0]?.message?.content || '';
      return this.resultFromRaw({
        sourcePack,
        modelId: payload.model || modelId,
        promptHash,
        rawOutput,
        started,
        repairAttempt,
        endpoint,
        usage: toJsonRecord(payload.usage || {}),
      });
    } catch (error) {
      return this.failedResult({
        sourcePack,
        modelId,
        promptHash,
        started,
        detail: error instanceof Error ? error.message : String(error),
        repairAttempt,
        endpoint,
      });
    }
  }

  private resultFromRaw(args: {
    sourcePack: FormulaSourcePack;
    modelId: string;
    promptHash: string;
    rawOutput: string;
    started: number;
    repairAttempt: boolean;
    endpoint: string;
    usage: JsonRecord;
  }): FormulaAgentRunResult {
    const parsed = parseExtractorOutput(args.rawOutput);
    return {
      agentRole: 'qwen_extractor',
      modelId: args.modelId,
      promptVersion: this.prompts.promptVersion,
      promptHash: args.promptHash,
      rawOutput: parsed.sanitizedOutput,
      sanitizedOutput: parsed.sanitizedOutput,
      parsedArtifact: parsed.parsed,
      validationErrors: parsed.validationErrors,
      latencyMs: Date.now() - args.started,
      status: parsed.parsed ? 'parsed' : 'invalid',
      metadata: {
        sourcePackId: args.sourcePack.sourcePackId,
        endpoint: args.endpoint,
        repairAttempt: args.repairAttempt,
        usage: args.usage,
        rawOutputRedacted: true,
      },
    };
  }

  private failedResult(args: {
    sourcePack: FormulaSourcePack;
    modelId: string;
    promptHash: string;
    started: number;
    detail: string;
    repairAttempt: boolean;
    endpoint: string;
  }): FormulaAgentRunResult {
    return {
      agentRole: 'qwen_extractor',
      modelId: args.modelId,
      promptVersion: this.prompts.promptVersion,
      promptHash: args.promptHash,
      rawOutput: '',
      sanitizedOutput: '',
      parsedArtifact: null,
      validationErrors: [args.detail],
      latencyMs: Date.now() - args.started,
      status: 'failed',
      metadata: {
        sourcePackId: args.sourcePack.sourcePackId,
        endpoint: args.endpoint,
        repairAttempt: args.repairAttempt,
      },
    };
  }
}

@Injectable()
export class CodexFormulaExtractorService {
  constructor(private readonly prompts: FormulaExtractorPromptService) {}

  async extract(sourcePack: FormulaSourcePack): Promise<FormulaAgentRunResult> {
    const prompt = this.prompts.buildExtractorPrompt(sourcePack, 'Codex');
    const first = await this.runPrompt(sourcePack, prompt, false);
    if (first.status === 'parsed') {
      return first;
    }
    const repairPrompt = this.prompts.buildJsonRepairPrompt({
      sourcePack,
      invalidOutput: first.sanitizedOutput || first.rawOutput,
      validationErrors: first.validationErrors,
    });
    return this.runPrompt(sourcePack, repairPrompt, true);
  }

  private async runPrompt(
    sourcePack: FormulaSourcePack,
    prompt: string,
    repairAttempt: boolean,
  ): Promise<FormulaAgentRunResult> {
    const started = Date.now();
    const command = process.env.FORMULA_CODEX_CLI || 'codex';
    const modelId = process.env.FORMULA_CODEX_MODEL || 'gpt-5.4';
    const args = this.codexArgs(modelId);
    const promptHash = sha256Hex(prompt);

    try {
      const rawOutput = await this.spawnWithInput(command, args, prompt);
      const parsed = parseExtractorOutput(rawOutput);
      return {
        agentRole: 'codex_extractor',
        modelId,
        promptVersion: this.prompts.promptVersion,
        promptHash,
        rawOutput: parsed.sanitizedOutput,
        sanitizedOutput: parsed.sanitizedOutput,
        parsedArtifact: parsed.parsed,
        validationErrors: parsed.validationErrors,
        latencyMs: Date.now() - started,
        status: parsed.parsed ? 'parsed' : 'invalid',
        metadata: {
          sourcePackId: sourcePack.sourcePackId,
          command,
          args,
          repairAttempt,
          rawOutputRedacted: true,
        },
      };
    } catch (error) {
      return {
        agentRole: 'codex_extractor',
        modelId,
        promptVersion: this.prompts.promptVersion,
        promptHash,
        rawOutput: '',
        sanitizedOutput: '',
        parsedArtifact: null,
        validationErrors: [
          error instanceof Error ? error.message : String(error),
        ],
        latencyMs: Date.now() - started,
        status: 'failed',
        metadata: {
          sourcePackId: sourcePack.sourcePackId,
          command,
          args,
          repairAttempt,
        },
      };
    }
  }

  private codexArgs(modelId: string): string[] {
    const configured = process.env.FORMULA_CODEX_ARGS_JSON;
    if (configured) {
      try {
        const parsed = JSON.parse(configured) as unknown;
        if (
          Array.isArray(parsed) &&
          parsed.every((item): item is string => typeof item === 'string')
        ) {
          return parsed;
        }
      } catch {
        return this.defaultCodexArgs(modelId);
      }
    }
    return this.defaultCodexArgs(modelId);
  }

  private defaultCodexArgs(modelId: string): string[] {
    return [
      'exec',
      '--model',
      modelId,
      '--sandbox',
      'read-only',
      '--skip-git-repo-check',
      '--ephemeral',
      '-',
    ];
  }

  private spawnWithInput(
    command: string,
    args: string[],
    input: string,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeoutMs = Number(process.env.FORMULA_CODEX_TIMEOUT_MS || 180_000);
      const child = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env,
      });
      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`Codex CLI timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });
      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve(stdout || stderr);
          return;
        }
        reject(
          new Error(
            `Codex CLI exited with ${code}: ${(stderr || stdout).trim()}`,
          ),
        );
      });
      child.stdin.write(input);
      child.stdin.end();
    });
  }
}

@Injectable()
export class ClaudeFormulaJudgeService {
  constructor(private readonly prompts: FormulaExtractorPromptService) {}

  async judge(input: FormulaJudgeRunInput): Promise<FormulaJudgeRunResult> {
    const prompt = this.prompts.buildJudgePrompt(input);
    const started = Date.now();
    const command = process.env.FORMULA_CLAUDE_CLI || 'claude';
    const modelId = input.highRisk
      ? process.env.FORMULA_CLAUDE_HIGH_RISK_MODEL || 'claude-opus-4-6'
      : process.env.FORMULA_CLAUDE_JUDGE_MODEL || 'claude-sonnet-4-6';
    const args = this.claudeArgs(modelId);
    const promptHash = sha256Hex(prompt);

    try {
      const rawOutput = await this.spawnWithInput(command, args, prompt);
      const parsed = parseJudgeOutput(rawOutput);
      return {
        agentRole: 'claude_judge',
        modelId,
        promptVersion: 'formula-judge-v1',
        promptHash,
        rawOutput: parsed.sanitizedOutput,
        sanitizedOutput: parsed.sanitizedOutput,
        parsedArtifact: parsed.parsed,
        validationErrors: parsed.validationErrors,
        latencyMs: Date.now() - started,
        status: parsed.parsed ? 'parsed' : 'invalid',
        metadata: {
          sourcePackId: input.sourcePack.sourcePackId,
          command,
          args,
          highRisk: !!input.highRisk,
          rawOutputRedacted: true,
        },
      };
    } catch (error) {
      return {
        agentRole: 'claude_judge',
        modelId,
        promptVersion: 'formula-judge-v1',
        promptHash,
        rawOutput: '',
        sanitizedOutput: '',
        parsedArtifact: null,
        validationErrors: [
          error instanceof Error ? error.message : String(error),
        ],
        latencyMs: Date.now() - started,
        status: 'failed',
        metadata: {
          sourcePackId: input.sourcePack.sourcePackId,
          command,
          args,
          highRisk: !!input.highRisk,
        },
      };
    }
  }

  private claudeArgs(modelId: string): string[] {
    const configured = process.env.FORMULA_CLAUDE_ARGS_JSON;
    if (configured) {
      try {
        const parsed = JSON.parse(configured) as unknown;
        if (
          Array.isArray(parsed) &&
          parsed.every((item): item is string => typeof item === 'string')
        ) {
          return parsed;
        }
      } catch {
        return this.defaultClaudeArgs(modelId);
      }
    }
    return this.defaultClaudeArgs(modelId);
  }

  private defaultClaudeArgs(modelId: string): string[] {
    return [
      '-p',
      '--model',
      modelId,
      '--output-format',
      'text',
      '--permission-mode',
      'dontAsk',
      '--tools',
      '',
    ];
  }

  private spawnWithInput(
    command: string,
    args: string[],
    input: string,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeoutMs = Number(
        process.env.FORMULA_CLAUDE_TIMEOUT_MS || 180_000,
      );
      const child = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env,
      });
      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`Claude CLI timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });
      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve(stdout || stderr);
          return;
        }
        reject(
          new Error(
            `Claude CLI exited with ${code}: ${(stderr || stdout).trim()}`,
          ),
        );
      });
      child.stdin.write(input);
      child.stdin.end();
    });
  }
}
