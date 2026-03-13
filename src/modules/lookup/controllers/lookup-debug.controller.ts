import { Body, Controller, Get, Logger, Param, Post, Query } from '@nestjs/common';
import { IntentRuleDebugService } from '../services/intent-rule-debug.service';

interface StartSessionDto {
  query: string;
  expectedHtsNumber: string;
}

@Controller('lookup/debug')
export class LookupDebugController {
  private readonly logger = new Logger(LookupDebugController.name);

  constructor(private readonly debugService: IntentRuleDebugService) {}

  /** Create a new debug session and enqueue the AI loop. */
  @Post('sessions')
  async startSession(@Body() body: StartSessionDto): Promise<{ sessionId: string }> {
    this.logger.log(`Starting debug session: query="${body.query}" expected=${body.expectedHtsNumber}`);
    return this.debugService.startSession(body.query, body.expectedHtsNumber);
  }

  /** List recent debug sessions (latest first). */
  @Get('sessions')
  async listSessions(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    return this.debugService.listSessions(parseInt(page, 10), parseInt(pageSize, 10));
  }

  /** Get a single debug session with all iteration details (for polling). */
  @Get('sessions/:id')
  async getSession(@Param('id') id: string) {
    return this.debugService.getSession(id);
  }
}
