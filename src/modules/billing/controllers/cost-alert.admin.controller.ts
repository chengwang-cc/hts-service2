import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../admin/guards/admin.guard';
import { CostAlertService } from '../services/cost-alert.service';

/**
 * Read-only admin oversight of a partner's / business's cost-alert
 * setup. No edit affordance — partners manage their own alerts via
 * the portal endpoint (`cost-alert.controller.ts`); the admin panel
 * just shows "what's configured, has it fired this month, where".
 *
 * Mounted under `/api/v1/admin/organizations/:id/cost-alert` for
 * consistency with the rest of the org-detail pages.
 */
@Controller('admin/organizations')
@UseGuards(JwtAuthGuard, AdminGuard)
export class CostAlertAdminController {
  constructor(private readonly service: CostAlertService) {}

  @Get(':id/cost-alert')
  async getForOrg(@Param('id', ParseUUIDPipe) id: string) {
    const view = await this.service.getForAdmin(id);
    if (!view) {
      throw new NotFoundException('No cost alert configured for this organization');
    }
    return view;
  }
}
