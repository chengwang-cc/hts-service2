import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { resolveRequestContext } from '../../auth/interfaces/request-context.interface';
import {
  BulkDecisionDto,
  ClassifyLineDto,
  CreateSuggestionDto,
  DecideSuggestionDto,
} from '../dto/broker-decisions.dto';
import { BrokerAiSuggestionEntity } from '../entities';
import { BrokerDecisionsService } from '../services/broker-decisions.service';

@Controller('broker')
export class BrokerDecisionsController {
  constructor(private readonly decisions: BrokerDecisionsService) {}

  @Post('suggestions')
  async createSuggestion(@Req() req: Request, @Body() dto: CreateSuggestionDto) {
    return {
      success: true,
      data: await this.decisions.createSuggestion(
        resolveRequestContext(req),
        dto,
      ),
    };
  }

  @Get('suggestions')
  async list(
    @Req() req: Request,
    @Query('targetType') targetType: BrokerAiSuggestionEntity['targetType'],
    @Query('targetId') targetId: string,
  ) {
    return {
      success: true,
      data: await this.decisions.listForTarget(
        resolveRequestContext(req),
        targetType,
        targetId,
      ),
    };
  }

  @Post('suggestions/:id/decide')
  async decide(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideSuggestionDto,
  ) {
    return {
      success: true,
      data: await this.decisions.decideSuggestion(
        resolveRequestContext(req),
        id,
        dto,
      ),
    };
  }

  @Post('suggestions/bulk-decide')
  async bulkDecide(@Req() req: Request, @Body() dto: BulkDecisionDto) {
    return {
      success: true,
      data: await this.decisions.bulkDecide(resolveRequestContext(req), dto),
    };
  }

  @Post('entries/:entryId/lines/:lineId/classify')
  async classify(
    @Req() req: Request,
    @Param('entryId', ParseUUIDPipe) entryId: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body() dto: ClassifyLineDto,
  ) {
    return {
      success: true,
      data: await this.decisions.classifyLine(
        resolveRequestContext(req),
        entryId,
        lineId,
        dto,
      ),
    };
  }

  /**
   * Plan alias: POST /broker/lines/:id/classify.
   * Derives the entry from the line itself so callers don't need to thread
   * both ids through the URL.
   */
  @Post('lines/:lineId/classify')
  async classifyByLine(
    @Req() req: Request,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body() dto: ClassifyLineDto,
  ) {
    return {
      success: true,
      data: await this.decisions.classifyLineById(
        resolveRequestContext(req),
        lineId,
        dto,
      ),
    };
  }

  /**
   * Plan alias: POST /broker/lines/:id/decision.
   * Accepts {suggestionId, decision, ...} as the payload because a line may
   * have multiple pending suggestions.
   */
  @Post('lines/:lineId/decision')
  async lineDecision(
    @Req() req: Request,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body()
    body: {
      suggestionId: string;
      decision: 'accept' | 'reject' | 'override';
      finalValue?: Record<string, unknown>;
      reason?: string;
      licensedBrokerSatisfied?: boolean;
      licensedBrokerUserId?: string | null;
    },
  ) {
    return {
      success: true,
      data: await this.decisions.lineDecision(
        resolveRequestContext(req),
        lineId,
        body,
      ),
    };
  }

  @Get('lines/:lineId/evidence')
  async evidence(
    @Req() req: Request,
    @Param('lineId', ParseUUIDPipe) lineId: string,
  ) {
    return {
      success: true,
      data: await this.decisions.listEvidenceForLine(
        resolveRequestContext(req),
        lineId,
      ),
    };
  }

  /**
   * R1-C-02 — UI pre-flight. Returns the pending suggestion types on a
   * target with their licensed-broker requirement, so the workbench can
   * pre-check the Accept button before the user clicks.
   */
  @Get('suggestions/acceptability')
  async acceptability(
    @Req() req: Request,
    @Query('targetType') targetType: BrokerAiSuggestionEntity['targetType'],
    @Query('targetId') targetId: string,
  ) {
    return {
      success: true,
      data: await this.decisions.checkAcceptability(
        resolveRequestContext(req),
        targetType,
        targetId,
      ),
    };
  }

  /**
   * R1-C-04 — "reuse prior decision" search. Returns recent accepted /
   * overridden decisions on lines whose description ILIKE %q%.
   */
  @Get('decisions/search-prior')
  async searchPrior(
    @Req() req: Request,
    @Query('q') q: string,
    @Query('limit') limit?: string,
  ) {
    return {
      success: true,
      data: await this.decisions.searchPriorDecisions(
        resolveRequestContext(req),
        q ?? '',
        limit ? Number(limit) : undefined,
      ),
    };
  }

  /**
   * R2-A-04 — get / patch the org's AI control policy.
   */
  @Get('ai-policy')
  async getAiPolicy(@Req() req: Request) {
    return {
      success: true,
      data: await this.decisions.getAiControlPolicy(
        resolveRequestContext(req),
      ),
    };
  }

  @Post('ai-policy')
  async setAiPolicy(
    @Req() req: Request,
    @Body()
    body: {
      allowedSuggestionTypes?: string[];
      confidenceThreshold?: number;
      licensedApprovalRequiredFor?: string[];
      autoAcceptCeiling?: number;
    },
  ) {
    return {
      success: true,
      data: await this.decisions.setAiControlPolicy(
        resolveRequestContext(req),
        body ?? {},
      ),
    };
  }

  @Get('entries/:entryId/decisions')
  async entryDecisions(
    @Req() req: Request,
    @Param('entryId', ParseUUIDPipe) entryId: string,
  ) {
    return {
      success: true,
      data: await this.decisions.listDecisionsForEntry(
        resolveRequestContext(req),
        entryId,
      ),
    };
  }
}
