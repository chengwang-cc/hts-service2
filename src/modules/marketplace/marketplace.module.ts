import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminGuard } from '../admin/guards/admin.guard';
import { AdminPermissionsGuard } from '../admin/guards/admin-permissions.guard';
import { AuditModule } from '../audit/audit.module';
import { DocumentsModule } from '../documents/documents.module';
import { SecurityModule } from '../security/security.module';
import { MarketplaceAdminController } from './controllers/marketplace-admin.controller';
import { MarketplaceController } from './controllers/marketplace.controller';
import {
  MarketplaceBrokerCredentialEntity,
  MarketplaceBrokerProfileEntity,
} from './entities';
import { MarketplaceService } from './services/marketplace.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      MarketplaceBrokerProfileEntity,
      MarketplaceBrokerCredentialEntity,
    ]),
    AuditModule,
    DocumentsModule,
    SecurityModule,
  ],
  controllers: [MarketplaceController, MarketplaceAdminController],
  providers: [MarketplaceService, AdminGuard, AdminPermissionsGuard],
  exports: [MarketplaceService],
})
export class MarketplaceModule {}
