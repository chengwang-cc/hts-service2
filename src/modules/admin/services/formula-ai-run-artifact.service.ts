import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { mkdir, readFile, readdir, writeFile } from 'fs/promises';
import { join } from 'path';
import type {
  FormulaAgentRunResult,
  FormulaJudgeRunInput,
  FormulaJudgeRunResult,
} from './formula-llm-runner.service';
import { FormulaExtractorPromptService } from './formula-llm-runner.service';
import type {
  FormulaSourcePack,
  JsonRecord,
} from './formula-ai-validation.schemas';
import type { FormulaLlmComparisonResult } from './formula-llm-comparison.service';
import {
  sanitizeAssistantJson,
  sha256Hex,
  toJsonRecord,
} from './formula-ai-validation.util';

export interface FormulaAiCouncilRunArtifact {
  runId: string;
  sourcePackId: string;
  htsNumber: string;
  sourceVersion: string;
  createdAt: string;
  artifactPath: string;
  promptSnapshots: {
    qwen: FormulaAiPromptSnapshot;
    codex: FormulaAiPromptSnapshot;
    claudeJudge: FormulaAiPromptSnapshot | null;
  };
  sourcePack: FormulaSourcePack;
  qwen: FormulaAgentRunResult;
  codex: FormulaAgentRunResult;
  comparison: FormulaLlmComparisonResult;
  judge: FormulaJudgeRunResult | null;
  packet: JsonRecord | null;
  skillFeedback: JsonRecord[];
  parserDisagrees: boolean;
  metadata: JsonRecord;
}

export interface FormulaAiPromptSnapshot {
  promptVersion: string;
  promptHash: string;
  promptText: string;
  matchesRunPromptHash: boolean;
}

export interface FormulaAiCouncilRunSummary {
  runId: string;
  sourcePackId: string;
  htsNumber: string;
  sourceVersion: string;
  createdAt: string;
  artifactPath: string;
  promptHashes: {
    qwen: string;
    codex: string;
    claudeJudge: string | null;
  };
  parserDisagrees: boolean;
}

@Injectable()
export class FormulaAiRunArtifactService {
  constructor(private readonly prompts: FormulaExtractorPromptService) {}

  async persistCouncilRun(input: {
    sourcePack: FormulaSourcePack;
    qwen: FormulaAgentRunResult;
    codex: FormulaAgentRunResult;
    comparison: FormulaLlmComparisonResult;
    judge: FormulaJudgeRunResult | null;
    judgeInput: FormulaJudgeRunInput | null;
    packet: unknown;
    skillFeedback: unknown[];
    parserDisagrees: boolean;
    metadata?: JsonRecord | null;
  }): Promise<FormulaAiCouncilRunArtifact> {
    const runId = this.runId(input.sourcePack.htsNumber);
    const artifactPath = this.runPath(runId);
    const qwenPrompt = this.prompts.buildExtractorPrompt(input.sourcePack, 'Qwen');
    const codexPrompt = this.prompts.buildExtractorPrompt(input.sourcePack, 'Codex');
    const claudePrompt = input.judgeInput
      ? this.prompts.buildJudgePrompt(input.judgeInput)
      : null;
    const artifact: FormulaAiCouncilRunArtifact = {
      runId,
      sourcePackId: input.sourcePack.sourcePackId,
      htsNumber: input.sourcePack.htsNumber,
      sourceVersion: input.sourcePack.sourceVersion,
      createdAt: new Date().toISOString(),
      artifactPath,
      promptSnapshots: {
        qwen: this.promptSnapshot(
          input.qwen.promptVersion,
          input.qwen.promptHash,
          qwenPrompt,
        ),
        codex: this.promptSnapshot(
          input.codex.promptVersion,
          input.codex.promptHash,
          codexPrompt,
        ),
        claudeJudge:
          input.judge && claudePrompt
            ? this.promptSnapshot(
                input.judge.promptVersion,
                input.judge.promptHash,
                claudePrompt,
              )
            : null,
      },
      sourcePack: input.sourcePack,
      qwen: this.sanitizedRun(input.qwen),
      codex: this.sanitizedRun(input.codex),
      comparison: input.comparison,
      judge: input.judge ? this.sanitizedRun(input.judge) : null,
      packet: input.packet ? toJsonRecord(input.packet) : null,
      skillFeedback: input.skillFeedback.map((item) => toJsonRecord(item)),
      parserDisagrees: input.parserDisagrees,
      metadata: {
        source: 'formula-ai-council-run',
        ...(input.metadata || {}),
      },
    };
    await mkdir(this.artifactDir(), { recursive: true });
    await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
    return artifact;
  }

  toSummary(artifact: FormulaAiCouncilRunArtifact): FormulaAiCouncilRunSummary {
    return {
      runId: artifact.runId,
      sourcePackId: artifact.sourcePackId,
      htsNumber: artifact.htsNumber,
      sourceVersion: artifact.sourceVersion,
      createdAt: artifact.createdAt,
      artifactPath: artifact.artifactPath,
      promptHashes: {
        qwen: artifact.promptSnapshots.qwen.promptHash,
        codex: artifact.promptSnapshots.codex.promptHash,
        claudeJudge: artifact.promptSnapshots.claudeJudge?.promptHash || null,
      },
      parserDisagrees: artifact.parserDisagrees,
    };
  }

  async latestCouncilRun(): Promise<FormulaAiCouncilRunArtifact | null> {
    try {
      const files = (await readdir(this.artifactDir()))
        .filter((file) => file.startsWith('council-run-') && file.endsWith('.json'))
        .sort();
      const latest = files.at(-1);
      return latest ? await this.readRunFile(join(this.artifactDir(), latest)) : null;
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return null;
      }
      throw error;
    }
  }

  async councilRun(runId: string): Promise<FormulaAiCouncilRunArtifact> {
    if (!/^[a-zA-Z0-9_.-]+$/.test(runId)) {
      throw new BadRequestException('Invalid council run id');
    }
    try {
      return await this.readRunFile(this.runPath(runId));
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        throw new NotFoundException('Council run artifact not found');
      }
      throw error;
    }
  }

  private promptSnapshot(
    promptVersion: string,
    runPromptHash: string,
    promptText: string,
  ): FormulaAiPromptSnapshot {
    const reconstructedHash = sha256Hex(promptText);
    return {
      promptVersion,
      promptHash: runPromptHash,
      promptText,
      matchesRunPromptHash: reconstructedHash === runPromptHash,
    };
  }

  private sanitizedRun<T extends FormulaAgentRunResult | FormulaJudgeRunResult>(
    run: T,
  ): T {
    return {
      ...run,
      rawOutput: sanitizeAssistantJson(run.rawOutput),
      sanitizedOutput: sanitizeAssistantJson(run.sanitizedOutput || run.rawOutput),
      metadata: {
        ...run.metadata,
        rawOutputRedacted: true,
      },
    };
  }

  private async readRunFile(path: string): Promise<FormulaAiCouncilRunArtifact> {
    return JSON.parse(await readFile(path, 'utf8')) as FormulaAiCouncilRunArtifact;
  }

  private runId(htsNumber: string): string {
    const timestamp = new Date()
      .toISOString()
      .replace(/[-:.TZ]/g, '')
      .slice(0, 14);
    const hts = htsNumber.replace(/[^a-zA-Z0-9.]/g, '-');
    return `council-run-${timestamp}-${hts}-${randomUUID()}`;
  }

  private runPath(runId: string): string {
    return join(this.artifactDir(), `${runId}.json`);
  }

  private artifactDir(): string {
    return (
      process.env.FORMULA_AI_COUNCIL_RUN_DIR ||
      join(process.cwd(), 'var', 'formula-ai', 'council-runs')
    );
  }
}
