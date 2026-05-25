import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../guards/admin.guard';
import { AdminPermissionsGuard } from '../guards/admin-permissions.guard';
import { AdminPermissions } from '../decorators/admin-permissions.decorator';
import { FormulaAiValidationHealthService } from '../services/formula-ai-validation-health.service';
import {
  FormulaExtractorOutputSchema,
  FormulaSourcePack,
  FormulaSourcePackSchema,
} from '../services/formula-ai-validation.schemas';
import { FormulaSourcePackService } from '../services/formula-source-pack.service';
import {
  CodexFormulaExtractorService,
  ClaudeFormulaJudgeService,
  FormulaJudgeRunInput,
  QwenFormulaExtractorService,
} from '../services/formula-llm-runner.service';
import { FormulaLlmComparisonService } from '../services/formula-llm-comparison.service';
import { FormulaAiEvidenceService } from '../services/formula-ai-evidence.service';
import { toJsonRecord } from '../services/formula-ai-validation.util';
import {
  FormulaAiSkillName,
  FormulaAiSkillRegistryService,
} from '../services/formula-ai-skill-registry.service';
import { FormulaAiRolloutService } from '../services/formula-ai-rollout.service';
import { FormulaAiRunArtifactService } from '../services/formula-ai-run-artifact.service';
import { QueueService } from '../../queue/queue.service';

interface FormulaSourcePackRequest {
  htsNumber?: string;
  sourceVersion?: string;
  originCountry?: string;
  destinationCountry?: string;
  effectiveDate?: string;
  includeEvidence?: boolean;
  sourcePack?: unknown;
}

@ApiTags('Admin - Formula AI Validation')
@ApiBearerAuth()
@Controller('admin/formula-ai-validation')
@UseGuards(JwtAuthGuard, AdminGuard)
export class FormulaAiValidationAdminController {
  constructor(
    private readonly health: FormulaAiValidationHealthService,
    private readonly sourcePacks: FormulaSourcePackService,
    private readonly qwenExtractor: QwenFormulaExtractorService,
    private readonly codexExtractor: CodexFormulaExtractorService,
    private readonly comparison: FormulaLlmComparisonService,
    private readonly claudeJudge: ClaudeFormulaJudgeService,
    private readonly evidence: FormulaAiEvidenceService,
    private readonly skillRegistry: FormulaAiSkillRegistryService,
    private readonly rollout: FormulaAiRolloutService,
    private readonly runArtifacts: FormulaAiRunArtifactService,
    private readonly queueService: QueueService,
  ) {}

  @Get('health')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('admin.formulaAccuracy.read')
  @ApiOperation({
    summary: 'Check Claude CLI, Codex CLI, Qwen chat, and Qwen embedding readiness',
  })
  async healthCheck() {
    return {
      success: true,
      data: await this.health.checkAll(),
    };
  }

  @Get('source-pack')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('admin.formulaAccuracy.read')
  @ApiOperation({
    summary: 'Build immutable source pack for one HTS formula validation run',
  })
  async sourcePack(
    @Query('htsNumber') htsNumber?: string,
    @Query('sourceVersion') sourceVersion?: string,
    @Query('originCountry') originCountry?: string,
    @Query('destinationCountry') destinationCountry?: string,
    @Query('effectiveDate') effectiveDate?: string,
    @Query('includeEvidence') includeEvidence?: string,
  ) {
    if (!htsNumber) {
      throw new BadRequestException('htsNumber is required');
    }
    return {
      success: true,
      data: await this.sourcePacks.build({
        htsNumber,
        sourceVersion,
        originCountry,
        destinationCountry,
        effectiveDate,
        includeEvidence:
          includeEvidence === undefined ? undefined : includeEvidence !== 'false',
      }),
    };
  }

  @Post('extract/qwen')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('admin.formulaAccuracy.write')
  @ApiOperation({ summary: 'Run Qwen formula extraction for one source pack' })
  @ApiResponse({ status: 201, description: 'Qwen extraction completed' })
  async extractWithQwen(@Body() body: FormulaSourcePackRequest = {}) {
    const sourcePack = await this.resolveSourcePack(body);
    return {
      success: true,
      data: await this.qwenExtractor.extract(sourcePack),
    };
  }

  @Post('extract/codex')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('admin.formulaAccuracy.write')
  @ApiOperation({ summary: 'Run Codex CLI formula extraction for one source pack' })
  @ApiResponse({ status: 201, description: 'Codex extraction completed' })
  async extractWithCodex(@Body() body: FormulaSourcePackRequest = {}) {
    const sourcePack = await this.resolveSourcePack(body);
    return {
      success: true,
      data: await this.codexExtractor.extract(sourcePack),
    };
  }

  @Post('compare')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('admin.formulaAccuracy.write')
  @ApiOperation({ summary: 'Compare Codex and Qwen formula artifacts' })
  async compare(
    @Body()
    body: FormulaSourcePackRequest & {
      codexOutput?: unknown;
      qwenOutput?: unknown;
      createMismatchPacket?: boolean;
    } = {},
  ) {
    const sourcePack = await this.resolveSourcePack(body);
    const codexOutput = this.parseExtractorOutput(body.codexOutput, 'codexOutput');
    const qwenOutput = this.parseExtractorOutput(body.qwenOutput, 'qwenOutput');
    const comparison = this.comparison.compare({
      sourcePack,
      codexOutput,
      qwenOutput,
    });
    const packet = body.createMismatchPacket
      ? await this.comparison.createMismatchPacket({
          sourcePack,
          comparison,
        })
      : null;
    return {
      success: true,
      data: { comparison, packet },
    };
  }

  @Post('judge/claude')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('admin.formulaAccuracy.write')
  @ApiOperation({ summary: 'Run Claude judge for a formula disagreement' })
  async judgeWithClaude(
    @Body()
    body: FormulaSourcePackRequest & {
      codexOutput?: unknown;
      qwenOutput?: unknown;
      comparison?: Record<string, unknown>;
      highRisk?: boolean;
    } = {},
  ) {
    const sourcePack = await this.resolveSourcePack(body);
    const codexOutput = this.parseExtractorOutput(body.codexOutput, 'codexOutput');
    const qwenOutput = this.parseExtractorOutput(body.qwenOutput, 'qwenOutput');
    const comparison =
      body.comparison ||
      this.comparison.compare({
        sourcePack,
        codexOutput,
        qwenOutput,
      });
    const judgeRun = await this.claudeJudge.judge({
      sourcePack,
      codexOutput,
      qwenOutput,
      comparison: toJsonRecord(comparison),
      highRisk: !!body.highRisk,
    });
    const skillFeedback = await this.skillRegistry.recordJudgeFeedback({
      sourcePack,
      judgeRun,
    });
    return {
      success: true,
      data: { judge: judgeRun, skillFeedback },
    };
  }

  @Post('council/run')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('admin.formulaAccuracy.write')
  @ApiOperation({
    summary: 'Run Qwen, Codex, deterministic comparison, and optional Claude judge',
  })
  async runCouncil(
    @Body()
    body: FormulaSourcePackRequest & {
      judge?: boolean;
      createMismatchPacket?: boolean;
    } = {},
  ) {
    const sourcePack = await this.resolveSourcePack(body);
    const [qwen, codex] = await Promise.all([
      this.qwenExtractor.extract(sourcePack),
      this.codexExtractor.extract(sourcePack),
    ]);
    const comparison = this.comparison.compare({
      sourcePack,
      codexOutput: codex.parsedArtifact,
      qwenOutput: qwen.parsedArtifact,
      codexErrors: codex.validationErrors,
      qwenErrors: qwen.validationErrors,
    });
    const parserDisagrees = this.comparison.parserDisagreesWithSelected(
      sourcePack,
      comparison.selectedArtifact,
    );
    const shouldJudge =
      body.judge !== false && (comparison.requiresClaudeJudge || parserDisagrees);
    const judgeInput: FormulaJudgeRunInput | null = shouldJudge
      ? {
          sourcePack,
          codexOutput: codex.parsedArtifact,
          qwenOutput: qwen.parsedArtifact,
          comparison: toJsonRecord(comparison),
          deterministicParserOutput: sourcePack.knownParserOutput,
          evidence: toJsonRecord({
            knownEvidence: sourcePack.knownEvidence,
            knownCards: sourcePack.knownCards,
          }),
          highRisk: comparison.highRiskReasons.length > 0 || parserDisagrees,
        }
      : null;
    const judge = judgeInput ? await this.claudeJudge.judge(judgeInput) : null;
    const skillFeedback = await this.skillRegistry.recordJudgeFeedback({
      sourcePack,
      judgeRun: judge,
    });
    const packet = body.createMismatchPacket
      ? await this.comparison.createMismatchPacket({
          sourcePack,
          comparison,
          metadata: {
            qwenStatus: qwen.status,
            codexStatus: codex.status,
            judgeStatus: judge?.status || null,
            parserDisagrees,
          },
        })
      : null;
    const runArtifact = await this.runArtifacts.persistCouncilRun({
      sourcePack,
      qwen,
      codex,
      comparison,
      judge,
      judgeInput,
      packet,
      skillFeedback,
      parserDisagrees,
      metadata: toJsonRecord({
        createMismatchPacket: !!body.createMismatchPacket,
        triggeredBy: 'admin-api',
      }),
    });
    return {
      success: true,
      data: {
        sourcePack,
        qwen,
        codex,
        comparison,
        judge,
        packet,
        skillFeedback,
        parserDisagrees,
        runArtifact: this.runArtifacts.toSummary(runArtifact),
      },
    };
  }

  @Get('council/runs/latest')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('admin.formulaAccuracy.read')
  @ApiOperation({ summary: 'Get the latest persisted Formula AI council run artifact' })
  async latestCouncilRunArtifact() {
    return {
      success: true,
      data: await this.runArtifacts.latestCouncilRun(),
    };
  }

  @Get('council/runs/:runId')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('admin.formulaAccuracy.read')
  @ApiOperation({ summary: 'Get one persisted Formula AI council run artifact' })
  async councilRunArtifact(@Param('runId') runId: string) {
    return {
      success: true,
      data: await this.runArtifacts.councilRun(runId),
    };
  }

  @Post('review/accept')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('admin.formulaAccuracy.write')
  @ApiOperation({
    summary: 'Accept a selected LLM artifact as pending evidence and tests',
  })
  async acceptArtifact(
    @Body()
    body: FormulaSourcePackRequest & {
      artifact?: unknown;
      reviewer?: string;
      aiModel?: string;
      aiPromptVersion?: string;
      createRegressionTests?: boolean;
      enqueueRecompute?: boolean;
    } = {},
  ) {
    const sourcePack = await this.resolveSourcePack(body);
    const artifact = this.parseExtractorOutput(body.artifact, 'artifact');
    if (!artifact) {
      throw new BadRequestException('artifact is required');
    }
    return {
      success: true,
      data: await this.evidence.acceptArtifact({
        sourcePack,
        artifact,
        reviewer: body.reviewer,
        aiModel: body.aiModel,
        aiPromptVersion: body.aiPromptVersion,
        createRegressionTests: body.createRegressionTests,
        enqueueRecompute: body.enqueueRecompute,
      }),
    };
  }

  @Get('skill-registry')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('admin.formulaAccuracy.read')
  @ApiOperation({ summary: 'Get Formula AI prompt, rubric, feedback, and holdout registry' })
  async skillRegistrySnapshot() {
    return {
      success: true,
      data: await this.skillRegistry.snapshot(),
    };
  }

  @Post('skill-registry/feedback')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('admin.formulaAccuracy.write')
  @ApiOperation({ summary: 'Record human or system skill feedback' })
  async recordSkillFeedback(
    @Body()
    body: {
      source?: 'claude' | 'human' | 'holdout' | 'system';
      targetSkill?: FormulaAiSkillName;
      targetVersionId?: string;
      reviewer?: string;
      severity?: 'P1' | 'P2' | 'P3';
      message?: string;
      runId?: string;
      sourcePackId?: string;
      metadata?: Record<string, unknown>;
    } = {},
  ) {
    if (!body.targetSkill || !body.message) {
      throw new BadRequestException('targetSkill and message are required');
    }
    return {
      success: true,
      data: await this.skillRegistry.recordFeedback({
        source: body.source || 'human',
        targetSkill: body.targetSkill,
        targetVersionId: body.targetVersionId,
        reviewer: body.reviewer,
        severity: body.severity,
        message: body.message,
        runId: body.runId,
        sourcePackId: body.sourcePackId,
        metadata: body.metadata || null,
      }),
    };
  }

  @Post('skill-registry/versions')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('admin.formulaAccuracy.write')
  @ApiOperation({ summary: 'Create a draft Formula AI prompt/rubric version' })
  async proposeSkillVersion(
    @Body()
    body: {
      skill?: FormulaAiSkillName;
      promptVersion?: string;
      rubricVersion?: string;
      promptBody?: string;
      rubricBody?: string;
      createdBy?: string;
      changeSummary?: string;
      metadata?: Record<string, unknown>;
    } = {},
  ) {
    if (!body.skill || !body.promptVersion || !body.rubricVersion) {
      throw new BadRequestException(
        'skill, promptVersion, and rubricVersion are required',
      );
    }
    return {
      success: true,
      data: await this.skillRegistry.proposeVersion({
        skill: body.skill,
        promptVersion: body.promptVersion,
        rubricVersion: body.rubricVersion,
        promptBody: body.promptBody,
        rubricBody: body.rubricBody,
        createdBy: body.createdBy,
        changeSummary: body.changeSummary,
        metadata: body.metadata || null,
      }),
    };
  }

  @Post('skill-registry/versions/:versionId/approve')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('admin.formulaAccuracy.write')
  @ApiOperation({ summary: 'Approve a Formula AI prompt/rubric version' })
  async approveSkillVersion(
    @Param('versionId') versionId: string,
    @Body() body: { skill?: FormulaAiSkillName; actor?: string; note?: string } = {},
  ) {
    if (!body.skill) {
      throw new BadRequestException('skill is required');
    }
    return {
      success: true,
      data: await this.skillRegistry.approveVersion({
        skill: body.skill,
        versionId,
        actor: body.actor,
        note: body.note,
      }),
    };
  }

  @Post('skill-registry/versions/:versionId/promote')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('admin.formulaAccuracy.write')
  @ApiOperation({ summary: 'Promote a Formula AI prompt/rubric version' })
  async promoteSkillVersion(
    @Param('versionId') versionId: string,
    @Body() body: { skill?: FormulaAiSkillName; actor?: string; note?: string } = {},
  ) {
    if (!body.skill) {
      throw new BadRequestException('skill is required');
    }
    return {
      success: true,
      data: await this.skillRegistry.promoteVersion({
        skill: body.skill,
        versionId,
        actor: body.actor,
        note: body.note,
      }),
    };
  }

  @Post('skill-registry/rollback')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('admin.formulaAccuracy.write')
  @ApiOperation({ summary: 'Rollback a Formula AI prompt/rubric version' })
  async rollbackSkillVersion(
    @Body()
    body: {
      skill?: FormulaAiSkillName;
      targetVersionId?: string;
      actor?: string;
      note?: string;
    } = {},
  ) {
    if (!body.skill) {
      throw new BadRequestException('skill is required');
    }
    return {
      success: true,
      data: await this.skillRegistry.rollbackVersion({
        skill: body.skill,
        targetVersionId: body.targetVersionId,
        actor: body.actor,
        note: body.note,
      }),
    };
  }

  @Post('skill-registry/holdout/run')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('admin.formulaAccuracy.write')
  @ApiOperation({ summary: 'Run Formula AI holdout evaluation now' })
  async runHoldoutEvaluation(
    @Body()
    body: {
      skill?: FormulaAiSkillName;
      versionId?: string;
      metadata?: Record<string, unknown>;
    } = {},
  ) {
    return {
      success: true,
      data: await this.skillRegistry.runHoldoutEvaluation({
        skill: body.skill || 'extractor',
        versionId: body.versionId,
        metadata: body.metadata || null,
      }),
    };
  }

  @Post('skill-registry/holdout/enqueue')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('admin.formulaAccuracy.write')
  @ApiOperation({ summary: 'Queue Formula AI holdout evaluation' })
  async enqueueHoldoutEvaluation(
    @Body()
    body: {
      skill?: FormulaAiSkillName;
      versionId?: string;
      triggeredBy?: string;
    } = {},
  ) {
    const jobId = await this.queueService.sendJob('formula-ai-holdout-evaluation', {
      skill: body.skill || 'extractor',
      versionId: body.versionId,
      triggeredBy: body.triggeredBy || 'admin-ui',
    });
    return {
      success: true,
      data: { jobId },
    };
  }

  @Get('rollout/policy')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('admin.formulaAccuracy.read')
  @ApiOperation({ summary: 'Get Formula AI rollout policy and rollback criteria' })
  async rolloutPolicy() {
    return {
      success: true,
      data: this.rollout.policy(),
    };
  }

  @Get('rollout/latest')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('admin.formulaAccuracy.read')
  @ApiOperation({ summary: 'Get latest Formula AI rollout dry-run artifact' })
  async latestRolloutRun() {
    return {
      success: true,
      data: await this.rollout.latestRun(),
    };
  }

  @Post('rollout/dry-run')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('admin.formulaAccuracy.write')
  @ApiOperation({ summary: 'Run 10-formula Formula AI dry-run rollout' })
  async runDryRunRollout(
    @Body()
    body: {
      htsNumbers?: string[];
      limit?: number;
      sourceVersion?: string;
      originCountry?: string;
      destinationCountry?: string;
      runAgents?: boolean;
      judge?: boolean;
      useFixtures?: boolean;
      autoCreatePendingEvidence?: boolean;
    } = {},
  ) {
    return {
      success: true,
      data: await this.rollout.run({
        ...body,
        mode: 'ten_formula_dry_run',
        triggeredBy: 'admin-ui',
      }),
    };
  }

  @Post('rollout/chapter')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('admin.formulaAccuracy.write')
  @ApiOperation({ summary: 'Run one-chapter Formula AI dry-run rollout' })
  async runChapterRollout(
    @Body()
    body: {
      chapter?: string;
      limit?: number;
      sourceVersion?: string;
      originCountry?: string;
      destinationCountry?: string;
      runAgents?: boolean;
      judge?: boolean;
      useFixtures?: boolean;
      autoCreatePendingEvidence?: boolean;
    } = {},
  ) {
    if (!body.chapter && !body.useFixtures) {
      throw new BadRequestException('chapter is required');
    }
    return {
      success: true,
      data: await this.rollout.run({
        ...body,
        mode: 'chapter',
        triggeredBy: 'admin-ui',
      }),
    };
  }

  private async resolveSourcePack(
    body: FormulaSourcePackRequest,
  ): Promise<FormulaSourcePack> {
    if (body.sourcePack) {
      const parsed = FormulaSourcePackSchema.safeParse(body.sourcePack);
      if (!parsed.success) {
        throw new BadRequestException(
          parsed.error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('; '),
        );
      }
      return parsed.data;
    }
    if (!body.htsNumber) {
      throw new BadRequestException('Either sourcePack or htsNumber is required');
    }
    return this.sourcePacks.build({
      htsNumber: body.htsNumber,
      sourceVersion: body.sourceVersion,
      originCountry: body.originCountry,
      destinationCountry: body.destinationCountry,
      effectiveDate: body.effectiveDate,
      includeEvidence: body.includeEvidence,
    });
  }

  private parseExtractorOutput(value: unknown, fieldName: string) {
    if (!value) {
      return null;
    }
    const parsed = FormulaExtractorOutputSchema.safeParse(value);
    if (!parsed.success) {
      throw new BadRequestException(
        `${fieldName}: ${parsed.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ')}`,
      );
    }
    return parsed.data;
  }
}
