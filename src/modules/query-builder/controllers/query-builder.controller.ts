import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { WrapResponseInterceptor } from '../../observability/wrap-response.interceptor';
import {
  QueryBuilderInputDto,
  QueryBuilderTemplateDto,
} from '../dto/query-builder.dto';
import { QueryBuilderService } from '../services/query-builder.service';

/**
 * Public (authenticated) query builder endpoints.
 *
 *   POST /knowledge/query-builder/preview   — planner only
 *   POST /knowledge/query-builder/run       — planner + retrieval
 *   GET  /knowledge/query-builder/templates — list saved templates
 *   POST /knowledge/query-builder/templates — save a template
 *   DELETE /knowledge/query-builder/templates/:id
 */
@ApiTags('knowledge query-builder')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@UseInterceptors(WrapResponseInterceptor)
@Controller('knowledge/query-builder')
export class QueryBuilderController {
  constructor(private readonly service: QueryBuilderService) {}

  @Post('preview')
  @ApiOperation({
    summary: 'Plan a knowledge query without running retrieval.',
  })
  async preview(@Body() body: QueryBuilderInputDto) {
    return this.service.plan(body);
  }

  @Post('run')
  @ApiOperation({ summary: 'Plan and execute a knowledge query.' })
  async run(@Body() body: QueryBuilderInputDto) {
    return this.service.run(body);
  }

  @Get('templates')
  @ApiOperation({ summary: 'List saved query templates for this organization.' })
  async listTemplates(@Req() req: any) {
    const organizationId = req?.user?.organizationId ?? null;
    return this.service.listTemplates(organizationId);
  }

  @Post('templates')
  @ApiOperation({ summary: 'Save a query template for this organization.' })
  async saveTemplate(
    @Body() body: QueryBuilderTemplateDto,
    @Req() req: any,
  ) {
    const organizationId = req?.user?.organizationId ?? null;
    const actor = req?.user?.email ?? req?.user?.id ?? 'system';
    return this.service.saveTemplate(organizationId, actor, body);
  }

  @Delete('templates/:id')
  @ApiOperation({ summary: 'Delete a saved query template.' })
  async deleteTemplate(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: any,
  ) {
    const organizationId = req?.user?.organizationId ?? null;
    await this.service.deleteTemplate(organizationId, id);
    return { ok: true };
  }
}
