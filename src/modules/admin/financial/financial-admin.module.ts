import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrganizationEntity } from '../../auth/entities/organization.entity';
import { CreditLedgerEntity } from '../../billing/entities/credit-ledger.entity';
import { BillingModule } from '../../billing/billing.module';
import { FinancialAdminController } from './financial-admin.controller';
import { FinanceAdminGuard } from './guards/finance-admin.guard';
import { ManualAdjustmentService } from './services/manual-adjustment.service';

/**
 * Wires the financial admin surface. Imports BillingModule to reach
 * LedgerService; imports the IdempotencyModule transitively via that
 * module's global @Global() decoration (no explicit import needed
 * here).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([OrganizationEntity, CreditLedgerEntity]),
    BillingModule,
  ],
  controllers: [FinancialAdminController],
  providers: [ManualAdjustmentService, FinanceAdminGuard],
  exports: [ManualAdjustmentService],
})
export class FinancialAdminModule {}
