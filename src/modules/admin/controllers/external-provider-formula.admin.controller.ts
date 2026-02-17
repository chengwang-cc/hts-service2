import {
  Controller,
  Get,
  Post,
  HttpCode,
  Param,
  Query,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../guards/admin.guard';
import { AdminPermissionsGuard } from '../guards/admin-permissions.guard';
import { AdminPermissions } from '../decorators/admin-permissions.decorator';
import { ExternalProviderFormulaAdminService } from '../services/external-provider-formula.admin.service';
import {
  AnalyzeExternalProviderDiscrepancyDto,
  CompareExternalProviderFormulaDto,
  ListExternalProviderFormulasDto,
  ManualReviewExternalProviderFormulaDto,
  PublishExternalProviderFormulaDto,
  ReviewExternalProviderFormulaDto,
  UpsertExternalProviderFormulaDto,
  ValidateExternalProviderFormulaDto,
} from '../dto/external-provider-formula.dto';

@ApiTags('Admin - External Provider Formulas')
@ApiBearerAuth()
@Controller('admin/external-provider-formulas')
@UseGuards(JwtAuthGuard, AdminGuard)
export class ExternalProviderFormulaAdminController {
  constructor(
    private readonly externalProviderFormulaService: ExternalProviderFormulaAdminService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create or upsert external provider formula snapshot' })
  @ApiResponse({ status: 201, description: 'Snapshot stored successfully' })
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('formula:external:write', 'formula:override')
  async upsert(@Body() dto: UpsertExternalProviderFormulaDto, @Request() req) {
    const userId = req.user?.email || null;
    const result = await this.externalProviderFormulaService.upsertSnapshot(dto, userId);

    return {
      success: true,
      data: result.data,
      meta: {
        action: result.action,
        contextHash: result.contextHash,
        previousId: result.previousId || null,
      },
    };
  }

  @Post('validate')
  @ApiOperation({ summary: 'Validate formula against external provider and persist snapshot' })
  @ApiResponse({ status: 201, description: 'Validation completed successfully' })
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('formula:external:write', 'formula:override')
  async validate(@Body() dto: ValidateExternalProviderFormulaDto, @Request() req) {
    const userId = req.user?.email || null;
    const result = await this.externalProviderFormulaService.validateAgainstProvider(dto, userId);

    return {
      success: true,
      data: result,
    };
  }

  @Post('manual-review')
  @ApiOperation({
    summary:
      'Create manual provider snapshot from admin-copied formula, compare against live HTS, and optionally analyze discrepancy',
  })
  @ApiResponse({ status: 201, description: 'Manual review context created successfully' })
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('formula:external:write', 'formula:override')
  async manualReview(@Body() dto: ManualReviewExternalProviderFormulaDto, @Request() req) {
    const userId = req.user?.email || null;
    const result = await this.externalProviderFormulaService.manualReviewSnapshot(dto, userId);
    return {
      success: true,
      data: result,
    };
  }

  @Post(':id/review')
  @HttpCode(200)
  @ApiOperation({ summary: 'Approve or reject a provider snapshot review' })
  @ApiResponse({ status: 200, description: 'Review status updated successfully' })
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('formula:external:write', 'formula:override')
  async reviewSnapshot(
    @Param('id') id: string,
    @Body() dto: ReviewExternalProviderFormulaDto,
    @Request() req,
  ) {
    const userId = req.user?.email || null;
    const result = await this.externalProviderFormulaService.reviewSnapshot(id, dto, userId);
    return {
      success: true,
      data: result,
    };
  }

  @Post(':id/publish-override')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Publish reviewed provider snapshot into carry-forward HTS formula override and patch active HTS entity',
  })
  @ApiResponse({ status: 200, description: 'Override published successfully' })
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('formula:external:write', 'formula:override')
  async publishOverride(
    @Param('id') id: string,
    @Body() dto: PublishExternalProviderFormulaDto,
    @Request() req,
  ) {
    const userId = req.user?.email || null;
    const result = await this.externalProviderFormulaService.publishFormulaOverrideFromSnapshot(
      id,
      dto,
      userId,
    );
    return {
      success: true,
      data: result,
    };
  }

  @Get()
  @ApiOperation({ summary: 'List external provider formula snapshots' })
  @ApiResponse({ status: 200, description: 'Snapshots retrieved successfully' })
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('formula:external:view', 'formula:view')
  async findAll(@Query() query: ListExternalProviderFormulasDto) {
    const result = await this.externalProviderFormulaService.findAll(query);

    return {
      success: true,
      data: result.data,
      meta: {
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
      },
    };
  }

  @Get('compare/live')
  @ApiOperation({ summary: 'Compare latest provider snapshot with live HTS formula' })
  @ApiResponse({ status: 200, description: 'Comparison completed successfully' })
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('formula:external:view', 'formula:view')
  async compareLive(@Query() query: CompareExternalProviderFormulaDto) {
    const result = await this.externalProviderFormulaService.compareWithLiveFormula(query);

    return {
      success: true,
      data: result,
    };
  }

  @Post('compare/analyze')
  @HttpCode(200)
  @ApiOperation({ summary: 'Analyze discrepancy between provider and live formulas' })
  @ApiResponse({ status: 200, description: 'Discrepancy analysis completed successfully' })
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('formula:external:view', 'formula:view')
  async analyzeComparison(@Body() dto: AnalyzeExternalProviderDiscrepancyDto) {
    const result = await this.externalProviderFormulaService.analyzeDiscrepancy(dto);

    return {
      success: true,
      data: result,
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get external provider formula snapshot by ID' })
  @ApiResponse({ status: 200, description: 'Snapshot retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Snapshot not found' })
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('formula:external:view', 'formula:view')
  async findOne(@Param('id') id: string) {
    const record = await this.externalProviderFormulaService.findOne(id);

    return {
      success: true,
      data: record,
    };
  }
}
