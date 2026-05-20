/**
 * Shopify order transactions — JWT-guarded surface for the website
 * dashboard. Parallels the embedded admin's /shopify/api/transactions but
 * scopes via the authenticated user's organization rather than a Shopify
 * session.
 *
 * Distinct from /shopify/api/* on purpose so it's never confused with the
 * Shopify-session-guarded admin endpoints.
 */
import {
  Controller,
  Get,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserEntity } from '../../auth/entities/user.entity';
import { ShopifyOrderTransactionsService } from '../services/shopify-order-transactions.service';

@Controller('shopify-orders')
@UseGuards(JwtAuthGuard)
export class ShopifyOrdersController {
  constructor(
    private readonly transactionsService: ShopifyOrderTransactionsService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: UserEntity,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('since') since?: string,
    @Query('until') until?: string,
  ) {
    if (!user?.organizationId) {
      throw new UnauthorizedException('Authentication required');
    }

    const parsedLimit = limit ? Number.parseInt(limit, 10) : undefined;
    const parsedOffset = offset ? Number.parseInt(offset, 10) : undefined;
    const sinceDate = parseDateOrNull(since);
    const untilDate = parseDateOrNull(until);

    return this.transactionsService.list(user.organizationId, {
      limit: Number.isFinite(parsedLimit) ? (parsedLimit as number) : undefined,
      offset: Number.isFinite(parsedOffset)
        ? (parsedOffset as number)
        : undefined,
      since: sinceDate,
      until: untilDate,
    });
  }
}

function parseDateOrNull(raw?: string): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}
