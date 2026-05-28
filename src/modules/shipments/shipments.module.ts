import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ShipmentsController } from './controllers/shipments.controller';
import { ShipmentsService } from './services/shipments.service';
import { SavedShipmentEntity } from './entities/saved-shipment.entity';
import { SavedShipmentQuoteSnapshotEntity } from './entities/saved-shipment-quote-snapshot.entity';

/**
 * Phase 5 — Workspace.
 *
 * Owns `POST/GET/PATCH/DELETE /api/v1/shipments` and friends. All routes are
 * JWT-gated. The service scopes every read/write to
 * (organizationId, userId | sharedWithOrg) so callers cannot reach another
 * tenant's data.
 *
 * Read the design spec at docs/2026-05-27/1458_calculator-v2-redesign-spec.md
 * §11 Phase 5 for full scope + endpoint contracts.
 */
@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([SavedShipmentEntity, SavedShipmentQuoteSnapshotEntity]),
  ],
  controllers: [ShipmentsController],
  providers: [ShipmentsService],
  exports: [ShipmentsService],
})
export class ShipmentsModule {}
