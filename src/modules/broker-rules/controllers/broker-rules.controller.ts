import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { OrgPermissions } from '../../auth/decorators/org-permissions.decorator';
import { OrgPermissionsGuard } from '../../auth/guards/org-permissions.guard';
import { resolveRequestContext } from '../../auth/interfaces/request-context.interface';
import {
  AcknowledgeIssueDto,
  UpsertRuleDto,
} from '../dto/broker-rules.dto';
import { BrokerRulesService } from '../services/broker-rules.service';

@Controller('broker')
@UseGuards(OrgPermissionsGuard)
export class BrokerRulesController {
  constructor(private readonly rules: BrokerRulesService) {}

  @Get('rules')
  @OrgPermissions('broker:rules:view', 'broker:rules:write')
  async list(@Req() req: Request) {
    return {
      success: true,
      data: await this.rules.listRules(resolveRequestContext(req)),
    };
  }

  @Post('rules')
  @OrgPermissions('broker:rules:write')
  async upsert(@Req() req: Request, @Body() dto: UpsertRuleDto) {
    return {
      success: true,
      data: await this.rules.upsertRule(resolveRequestContext(req), dto),
    };
  }

  @Post('entries/:id/validate')
  @OrgPermissions('broker:entries:write', 'broker:rules:write')
  async validate(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return {
      success: true,
      data: await this.rules.validateEntry(resolveRequestContext(req), id),
    };
  }

  @Get('entries/:id/issues')
  @OrgPermissions('broker:entries:view', 'broker:entries:write')
  async listIssues(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return {
      success: true,
      data: await this.rules.listResultsForEntry(
        resolveRequestContext(req),
        id,
      ),
    };
  }

  @Patch('issues/:issueId')
  @OrgPermissions('broker:entries:write', 'broker:rules:write')
  async ackIssue(
    @Req() req: Request,
    @Param('issueId', ParseUUIDPipe) issueId: string,
    @Body() dto: AcknowledgeIssueDto,
  ) {
    return {
      success: true,
      data: await this.rules.acknowledgeIssue(
        resolveRequestContext(req),
        issueId,
        dto,
      ),
    };
  }
}
