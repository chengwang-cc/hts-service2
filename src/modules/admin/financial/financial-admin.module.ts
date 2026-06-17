import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrganizationEntity } from '../../auth/entities/organization.entity';
import { CreditLedgerEntity } from '../../billing/entities/credit-ledger.entity';
import { AutoTopUpConfigEntity } from '../../billing/entities/auto-topup-config.entity';
import { CreditBalanceEntity } from '../../billing/entities/credit-balance.entity';
import { BillingModule } from '../../billing/billing.module';
import { FinancialAdminController } from './financial-admin.controller';
import { FinanceAdminGuard } from './guards/finance-admin.guard';
import { ManualAdjustmentService } from './services/manual-adjustment.service';
import { NegativeBalanceService } from './services/negative-balance.service';

/**
 * Wires the financial admin surface. Imports BillingModule to reach
 * LedgerService + StripeService; imports the IdempotencyModule
 * transitively via that module's global @Global() decoration (no
 * explicit import needed here).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      OrganizationEntity,
      CreditLedgerEntity,
      AutoTopUpConfigEntity,
      CreditBalanceEntity,
    ]),
    BillingModule,
  ],
  controllers: [FinancialAdminController],
  providers: [ManualAdjustmentService, NegativeBalanceService, FinanceAdminGuard],
  exports: [ManualAdjustmentService, NegativeBalanceService],
})
export class FinancialAdminModule {}
