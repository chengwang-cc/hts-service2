/**
 * P3.4 — Landed-Cost Quote Expirer
 *
 * Runs every 5 minutes (cron registered in AdminModule.onModuleInit when
 * LANDED_COST_QUOTE_EXPIRER_ENABLED=true). Sweeps `landed_cost_quotes`
 * rows where status='calculated' and expiresAt < now() and flips them
 * to status='expired'.
 */

import { Injectable, Logger } from '@nestjs/common';
import { LandedCostService } from '../../landed-cost/services/landed-cost.service';

@Injectable()
export class LandedCostQuoteExpirerJobHandler {
  private readonly logger = new Logger(LandedCostQuoteExpirerJobHandler.name);

  constructor(private readonly landedCost: LandedCostService) {}

  async execute(_job: any): Promise<void> {
    const expired = await this.landedCost.expireStale();
    if (expired > 0) {
      this.logger.log(`Expired ${expired} landed-cost quote(s)`);
    }
  }
}
