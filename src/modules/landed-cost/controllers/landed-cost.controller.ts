import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiKeyGuard } from '../../api-keys/guards/api-key.guard';
import { ApiPermissions } from '../../api-keys/decorators/api-permissions.decorator';
import { SkipJwtAuth } from '../../api-keys/decorators/skip-jwt-auth.decorator';
import { LandedCostQuoteRequestDto } from '../dto/quote-request.dto';
import { LandedCostService } from '../services/landed-cost.service';

interface CallerContext {
  organizationId: string;
  apiKeyId?: string;
}

function requireCallerContext(req: any): CallerContext {
  const userOrg = req?.user?.organizationId;
  if (userOrg) return { organizationId: userOrg };
  const apiOrg = req?.organizationId;
  if (apiOrg) return { organizationId: apiOrg, apiKeyId: req?.apiKey?.id };
  throw new ForbiddenException('Authenticated organization is required');
}

@Controller('landed-cost')
export class LandedCostController {
  constructor(private readonly landedCost: LandedCostService) {}

  // ── JWT-authenticated callers ─────────────────────────────────────────

  @Post('quotes')
  async createQuote(
    @Body() dto: LandedCostQuoteRequestDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: any,
  ) {
    const ctx = requireCallerContext(req);
    return this.run(ctx, dto, idempotencyKey);
  }

  @Get('quotes/:id')
  async getQuote(@Param('id') id: string, @Req() req: any) {
    const ctx = requireCallerContext(req);
    const row = await this.landedCost.getQuote(ctx.organizationId, id);
    if (!row) throw new NotFoundException('Quote not found');
    return row.responseJson;
  }

  @Post('quotes/:id/confirm')
  async confirm(@Param('id') id: string, @Req() req: any) {
    const ctx = requireCallerContext(req);
    return this.landedCost.confirm(ctx.organizationId, id);
  }

  @Post('quotes/:id/recalculate')
  async recalculate(@Param('id') id: string, @Req() req: any) {
    const ctx = requireCallerContext(req);
    return this.landedCost.recalculate(ctx.organizationId, id);
  }

  // ── API-key callers (machine clients) ─────────────────────────────────

  @SkipJwtAuth()
  @UseGuards(ApiKeyGuard)
  @ApiPermissions('landed-cost:write')
  @Post('quotes.api')
  async createQuoteApi(
    @Body() dto: LandedCostQuoteRequestDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: any,
  ) {
    const ctx = requireCallerContext(req);
    return this.run(ctx, dto, idempotencyKey);
  }

  private async run(
    ctx: CallerContext,
    dto: LandedCostQuoteRequestDto,
    idempotencyKey: string | undefined,
  ) {
    if (idempotencyKey && idempotencyKey.length > 128) {
      throw new BadRequestException('Idempotency-Key must be <= 128 chars');
    }
    try {
      return await this.landedCost.createQuote({
        organizationId: ctx.organizationId,
        apiKeyId: ctx.apiKeyId,
        idempotencyKey,
        request: dto,
      });
    } catch (e: any) {
      if (e?.code === 'IDEMPOTENCY_FINGERPRINT_MISMATCH') {
        throw new ConflictException({
          statusCode: 409,
          code: 'IDEMPOTENCY_FINGERPRINT_MISMATCH',
          message:
            'An idempotency key with a different request body was already used',
        });
      }
      if (e?.code === 'EU_REQUIRES_MEMBER_STATE') {
        throw new BadRequestException({
          statusCode: 400,
          code: 'EU_REQUIRES_MEMBER_STATE',
          message: e.message,
        });
      }
      if (e?.code === 'UNSUPPORTED_JURISDICTION') {
        throw new BadRequestException({
          statusCode: 400,
          code: 'UNSUPPORTED_JURISDICTION',
          message: e.message,
        });
      }
      throw new HttpException(
        e?.message || 'landed-cost failed',
        e?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
