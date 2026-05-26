import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  HttpStatus,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CalculatorV2QuoteService } from '../calculator-v2-quote.service';
import {
  CalculatorV2QuoteRequest,
  CalculatorV2QuoteResult,
} from '../calculator-v2-quote.types';
import type { JurisdictionFacts } from '../../jurisdiction/interfaces/tariff-jurisdiction-adapter.interface';
import { ApiKeyGuard } from '../../api-keys/guards/api-key.guard';
import { ApiPermissions } from '../../api-keys/decorators/api-permissions.decorator';
import { SkipJwtAuth } from '../../api-keys/decorators/skip-jwt-auth.decorator';
import {
  EuMemberStateRequiredError,
  UnsupportedJurisdictionError,
} from '../../jurisdiction/services/jurisdiction.service';

/**
 * CalculatorV2QuoteController
 *
 * Phase A entry point for the unified multi-country calculator. Exposes
 *   POST /api/v1/calculator/v2/quote   (JWT — browser path)
 *   POST /api/v2/calculator/quote      (API-key — public path)
 *
 * Both routes call CalculatorV2QuoteService.quote() and return a
 * RichCalculationResult-shaped CalculatorV2QuoteResult regardless of
 * destination. The browser route is the one the calculator-v2 UI
 * consumes; the API-key route mirrors it for external clients.
 */
@ApiTags('Calculator V2 Quote (unified multi-country)')
@Controller()
export class CalculatorV2QuoteController {
  constructor(private readonly quoteService: CalculatorV2QuoteService) {}

  // ── JWT-authenticated browser route ────────────────────────────────────

  @Post('calculator/v2/quote')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Unified multi-country calculator quote (JWT browser path)',
    description:
      'Single entry point for the calculator-v2 UI. Routes to the per-jurisdiction adapter for the requested destination and returns a RichCalculationResult with components, totals, sources, confidence, and jurisdictionFacts. Supports US/CA/GB/EU/HK/KR/SG/AU/NZ/TW.',
  })
  @ApiResponse({ status: 200, description: 'Quote produced' })
  @ApiResponse({ status: 400, description: 'Invalid request / unsupported destination / member state required' })
  async quoteJwt(
    @Body() request: CalculatorV2QuoteRequest,
    @Req() req: any,
  ): Promise<CalculatorV2QuoteResult> {
    const userOrg = req?.user?.organizationId ?? req?.organizationId;
    if (!userOrg) {
      throw new ForbiddenException('Authenticated organization is required');
    }
    return this.run(request, {
      organizationId: userOrg,
      userId: req?.user?.id,
    });
  }

  // ── Facts preview (form-side hint) ─────────────────────────────────────
  //
  // The calculator-v2 UI calls this when origin / destination / goods value
  // change so it can filter the trade-agreement picker, show a de-minimis
  // advisory, and label the schema all without running a full quote.

  @Get('calculator/v2/facts')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Preview JurisdictionFacts for the form (no calculation)',
  })
  @ApiQuery({ name: 'destination', required: true, description: 'ISO country code (e.g. AU). Use `EU+DE` for EU + member state.' })
  @ApiQuery({ name: 'origin', required: true })
  @ApiQuery({ name: 'goodsValue', required: false, description: 'Goods value in destination currency. Defaults to 0.' })
  @ApiQuery({ name: 'currency', required: false })
  async previewFacts(
    @Query('destination') destination: string,
    @Query('origin') origin: string,
    @Query('goodsValue') goodsValue?: string,
    @Query('currency') currency?: string,
    @Req() req?: any,
  ): Promise<JurisdictionFacts> {
    const userOrg = req?.user?.organizationId;
    if (!userOrg && !req?.organizationId) {
      throw new ForbiddenException('Authenticated organization is required');
    }
    return this.factsFromQuery({ destination, origin, goodsValue, currency });
  }

  @Get('api/v2/calculator/facts')
  @SkipJwtAuth()
  @UseGuards(ApiKeyGuard)
  @ApiPermissions('hts:calculate')
  @ApiOperation({
    summary: 'Preview JurisdictionFacts for the form (API-key path)',
  })
  async previewFactsApiKey(
    @Query('destination') destination: string,
    @Query('origin') origin: string,
    @Query('goodsValue') goodsValue?: string,
    @Query('currency') currency?: string,
  ): Promise<JurisdictionFacts> {
    return this.factsFromQuery({ destination, origin, goodsValue, currency });
  }

  private factsFromQuery(args: {
    destination: string;
    origin: string;
    goodsValue?: string;
    currency?: string;
  }): JurisdictionFacts {
    if (!args.destination) throw new BadRequestException('destination is required');
    if (!args.origin) throw new BadRequestException('origin is required');
    // Accept either `EU+DE` or plain `DE` shorthand.
    let destinationCountry = args.destination.toUpperCase();
    let memberState: string | undefined;
    if (destinationCountry.includes('+')) {
      const [c, ms] = destinationCountry.split('+');
      destinationCountry = c;
      memberState = ms;
    }
    const goods = args.goodsValue ? Number(args.goodsValue) : 0;
    return this.quoteService.factsFor({
      destinationCountry,
      destinationMemberState: memberState,
      originCountry: args.origin.toUpperCase(),
      goodsValue: Number.isFinite(goods) ? goods : 0,
      currency: args.currency || 'USD',
    });
  }

  // ── API-key route (mirror under /api/v2 namespace) ─────────────────────

  @Post('api/v2/calculator/quote')
  @SkipJwtAuth()
  @UseGuards(ApiKeyGuard)
  @ApiPermissions('hts:calculate')
  @ApiOperation({
    summary: 'Unified multi-country calculator quote (API-key path)',
  })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 400 })
  async quoteApiKey(
    @Body() request: CalculatorV2QuoteRequest,
    @Req() req: any,
  ): Promise<CalculatorV2QuoteResult> {
    return this.run(request, {
      organizationId: req?.organizationId,
    });
  }

  private async run(
    request: CalculatorV2QuoteRequest,
    caller: { organizationId?: string; userId?: string } = {},
  ): Promise<CalculatorV2QuoteResult> {
    this.validate(request);
    try {
      return await this.quoteService.quote(request, caller);
    } catch (e: any) {
      if (e instanceof EuMemberStateRequiredError) {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            code: 'EU_REQUIRES_MEMBER_STATE',
            message:
              'EU destination requires destination.memberState (e.g. DE, FR).',
          },
          HttpStatus.BAD_REQUEST,
        );
      }
      if (e instanceof UnsupportedJurisdictionError) {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            code: 'UNSUPPORTED_JURISDICTION',
            message: e.message,
          },
          HttpStatus.BAD_REQUEST,
        );
      }
      throw e;
    }
  }

  private validate(request: CalculatorV2QuoteRequest): void {
    if (!request) throw new BadRequestException('Request body is required.');
    if (!request.destination?.country) {
      throw new BadRequestException('destination.country is required.');
    }
    if (!request.origin?.country) {
      throw new BadRequestException('origin.country is required.');
    }
    if (!request.currency) {
      throw new BadRequestException('currency is required (ISO 4217).');
    }
    if (!Array.isArray(request.items) || request.items.length === 0) {
      throw new BadRequestException('items must contain at least one line.');
    }
    for (const [i, line] of request.items.entries()) {
      if (!line.classificationCode) {
        throw new BadRequestException(`items[${i}].classificationCode is required.`);
      }
      if (typeof line.quantity !== 'number' || line.quantity <= 0) {
        throw new BadRequestException(`items[${i}].quantity must be > 0.`);
      }
      if (typeof line.unitValue !== 'number' || line.unitValue < 0) {
        throw new BadRequestException(`items[${i}].unitValue must be ≥ 0.`);
      }
    }
  }
}
