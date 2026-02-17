import { Body, Controller, Post, UseGuards, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../guards/admin.guard';
import { AdminPermissionsGuard } from '../guards/admin-permissions.guard';
import { AdminPermissions } from '../decorators/admin-permissions.decorator';
import { RefreshReciprocalTariffDto } from '../dto/reciprocal-tariff.dto';
import { ReciprocalTariffAdminService } from '../services/reciprocal-tariff.admin.service';

@ApiTags('Admin - Reciprocal Tariffs')
@ApiBearerAuth()
@Controller('admin/reciprocal-tariffs')
@UseGuards(JwtAuthGuard, AdminGuard)
export class ReciprocalTariffAdminController {
  constructor(private readonly reciprocalTariffService: ReciprocalTariffAdminService) {}

  @Post('refresh')
  @ApiOperation({
    summary:
      'Deep-search official U.S. government reciprocal tariff policy and sync hts_extra_taxes records',
  })
  @ApiResponse({ status: 201, description: 'Reciprocal tariff refresh completed' })
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('formula:override', 'admin:settings')
  async refresh(@Body() dto: RefreshReciprocalTariffDto, @Request() req) {
    const userId = req.user?.email || null;
    const result = await this.reciprocalTariffService.refreshFromOfficialSources(dto, userId);
    return {
      success: true,
      data: result,
    };
  }
}

