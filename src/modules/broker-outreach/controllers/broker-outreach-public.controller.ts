import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../auth/decorators/public.decorator';
import { ClaimBrokerOutreachInviteDto } from '../dto/broker-outreach.dto';
import { BrokerOutreachService } from '../services/broker-outreach.service';

@ApiTags('broker outreach')
@Public()
@Controller('broker-outreach')
export class BrokerOutreachPublicController {
  constructor(private readonly outreach: BrokerOutreachService) {}

  @Get('invites/:token')
  @ApiOperation({
    summary:
      'Preview an outreach invite. Pure GET — does not record an open. The client should beacon POST /invites/:token/opened from a post-render hook to record human opens.',
  })
  async previewInvite(@Param('token') token: string) {
    return this.outreach.previewInvite(token);
  }

  @Post('invites/:token/opened')
  @ApiOperation({
    summary:
      'Record that a human opened the invite (called from a client-side beacon after hydrate).',
  })
  async recordInviteOpened(@Param('token') token: string) {
    return this.outreach.recordInviteOpened(token);
  }

  @Post('invites/:token/claim')
  @ApiOperation({ summary: 'Claim an outreach invite and create a trial workspace.' })
  async claimInvite(
    @Param('token') token: string,
    @Body() body: ClaimBrokerOutreachInviteDto,
  ) {
    return this.outreach.claimInvite(token, body);
  }
}
