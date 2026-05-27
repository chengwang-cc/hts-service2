import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { WrapResponseInterceptor } from '../../observability/wrap-response.interceptor';
import { DataTransformerService } from '../services/data-transformer.service';

@ApiTags('data transformer')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@UseInterceptors(WrapResponseInterceptor)
@Controller('data-transformer')
export class DataTransformerController {
  constructor(private readonly service: DataTransformerService) {}

  @Post('schema/infer')
  @ApiOperation({ summary: 'Infer column types from a sample row batch.' })
  async inferSchema(@Body() body: { rows: Array<Record<string, unknown>> }) {
    return this.service.inferSchema(body.rows ?? []);
  }

  @Get('profiles')
  @ApiOperation({ summary: 'List transformer profiles for this organization.' })
  async listProfiles(@Req() req: any) {
    return this.service.listProfiles(orgId(req));
  }

  @Post('profiles')
  @ApiOperation({ summary: 'Create a transformer profile.' })
  async createProfile(
    @Req() req: any,
    @Body()
    body: {
      name: string;
      description?: string;
      inputKind: string;
      outputKind: string;
      inputSchema: Record<string, unknown>;
      defaults?: Record<string, unknown>;
    },
  ) {
    return this.service.createProfile(orgId(req), actor(req), body);
  }

  @Get('profiles/:id/mappings')
  @ApiOperation({ summary: 'List the field mappings for a profile.' })
  async listMappings(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.listMappings(orgId(req), id);
  }

  @Post('profiles/:id/mappings')
  @ApiOperation({ summary: 'Replace all field mappings for a profile.' })
  async saveMappings(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { mappings: any[] },
  ) {
    return this.service.saveMappings(orgId(req), id, body.mappings ?? []);
  }

  @Post('profiles/:id/run')
  @ApiOperation({ summary: 'Run the profile transform over an inline row batch.' })
  async run(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { rows: Array<Record<string, unknown>> },
  ) {
    return this.service.run(orgId(req), {
      profileId: id,
      rows: body.rows ?? [],
      triggeredBy: actor(req),
    });
  }

  @Get('runs')
  @ApiOperation({ summary: 'List recent transformer runs.' })
  async listRuns(@Req() req: any, @Query('profileId') profileId?: string) {
    return this.service.listRuns(orgId(req), profileId);
  }

  @Get('runs/:id/issues')
  @ApiOperation({ summary: 'List issues recorded against a transformer run.' })
  async runIssues(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.getRunIssues(orgId(req), id);
  }
}

function orgId(req: any): string {
  const id = req?.user?.organizationId;
  if (!id) {
    throw new UnauthorizedException('authentication context required');
  }
  return id;
}

function actor(req: any): string {
  return req?.user?.email ?? req?.user?.id ?? 'system';
}
