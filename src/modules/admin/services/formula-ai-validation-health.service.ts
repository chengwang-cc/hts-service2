import { Injectable } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface FormulaAiHealthCheck {
  name: 'claudeCli' | 'codexCli' | 'qwenChat' | 'qwenEmbedding';
  ok: boolean;
  detail: string;
  command?: string;
  endpoint?: string;
  model?: string;
  elapsedMs: number;
}

export interface FormulaAiHealthReport {
  ok: boolean;
  checkedAt: string;
  checks: FormulaAiHealthCheck[];
}

@Injectable()
export class FormulaAiValidationHealthService {
  async checkAll(): Promise<FormulaAiHealthReport> {
    const checks = await Promise.all([
      this.checkCli({
        name: 'claudeCli',
        command: process.env.FORMULA_CLAUDE_CLI || 'claude',
        args: ['--version'],
      }),
      this.checkCli({
        name: 'codexCli',
        command: process.env.FORMULA_CODEX_CLI || 'codex',
        args: this.readJsonStringArray(
          process.env.FORMULA_CODEX_HEALTH_ARGS_JSON,
          ['exec', '--help'],
        ),
      }),
      this.checkOpenAiCompatibleModels({
        name: 'qwenChat',
        endpoint:
          process.env.FORMULA_QWEN_BASE_URL || 'http://192.168.1.10:6080/v1',
        model:
          process.env.FORMULA_QWEN_MODEL || 'Qwen/Qwen3.5-35B-A3B-FP8',
      }),
      this.checkOpenAiCompatibleModels({
        name: 'qwenEmbedding',
        endpoint:
          process.env.FORMULA_QWEN_EMBED_BASE_URL ||
          'http://192.168.1.10:6090/v1',
        model: process.env.FORMULA_QWEN_EMBED_MODEL || 'qwen3-0.6b-embed',
      }),
    ]);

    return {
      ok: checks.every((check) => check.ok),
      checkedAt: new Date().toISOString(),
      checks,
    };
  }

  private async checkCli(args: {
    name: FormulaAiHealthCheck['name'];
    command: string;
    args: string[];
  }): Promise<FormulaAiHealthCheck> {
    const started = Date.now();
    try {
      const result = await execFileAsync(args.command, args.args, {
        timeout: Number(process.env.FORMULA_AI_HEALTH_TIMEOUT_MS || 10_000),
        maxBuffer: 1024 * 1024,
      });
      const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
      return {
        name: args.name,
        ok: true,
        command: `${args.command} ${args.args.join(' ')}`,
        detail: this.truncate(
          output || `Command exited successfully with no output`,
        ),
        elapsedMs: Date.now() - started,
      };
    } catch (error) {
      return {
        name: args.name,
        ok: false,
        command: `${args.command} ${args.args.join(' ')}`,
        detail: error instanceof Error ? error.message : String(error),
        elapsedMs: Date.now() - started,
      };
    }
  }

  private async checkOpenAiCompatibleModels(args: {
    name: FormulaAiHealthCheck['name'];
    endpoint: string;
    model: string;
  }): Promise<FormulaAiHealthCheck> {
    const started = Date.now();
    const modelsUrl = `${args.endpoint.replace(/\/$/, '')}/models`;
    try {
      const response = await fetch(modelsUrl, {
        signal: AbortSignal.timeout(
          Number(process.env.FORMULA_AI_HEALTH_TIMEOUT_MS || 10_000),
        ),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = (await response.json()) as {
        data?: Array<{ id?: string }>;
      };
      const models = (payload.data || [])
        .map((model) => model.id)
        .filter((model): model is string => !!model);
      return {
        name: args.name,
        ok: models.includes(args.model),
        endpoint: modelsUrl,
        model: args.model,
        detail: models.includes(args.model)
          ? `Model available: ${args.model}`
          : `Model ${args.model} not found. Available: ${models.join(', ')}`,
        elapsedMs: Date.now() - started,
      };
    } catch (error) {
      return {
        name: args.name,
        ok: false,
        endpoint: modelsUrl,
        model: args.model,
        detail: error instanceof Error ? error.message : String(error),
        elapsedMs: Date.now() - started,
      };
    }
  }

  private readJsonStringArray(
    raw: string | undefined,
    fallback: string[],
  ): string[] {
    if (!raw) {
      return fallback;
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) &&
        parsed.every((item): item is string => typeof item === 'string')
        ? parsed
        : fallback;
    } catch {
      return fallback;
    }
  }

  private truncate(value: string): string {
    const limit = Number(process.env.FORMULA_AI_HEALTH_DETAIL_LIMIT || 1200);
    return value.length > limit ? `${value.slice(0, limit)}...` : value;
  }
}
