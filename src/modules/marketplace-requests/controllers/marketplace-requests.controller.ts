import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Logger,
  MessageEvent,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  RawBodyRequest,
  Req,
  Sse,
} from '@nestjs/common';
import type { Request } from 'express';
import { StripeService } from '../../billing/services/stripe.service';
import { interval, map, Observable } from 'rxjs';
import { Public } from '../../auth/decorators/public.decorator';
import { resolveRequestContext } from '../../auth/interfaces/request-context.interface';
import {
  AcceptQuoteDto,
  ConsentToFullPacketDto,
  CreateMarketplaceRequestDto,
  CreateQuoteDto,
  DeclineLeadDto,
  ListMarketplaceRequestsDto,
  SendMessageDto,
} from '../dto/marketplace-requests.dto';
import { MarketplaceRequestsService } from '../services/marketplace-requests.service';
import { RequestPreflightService } from '../services/request-preflight.service';

@Controller('marketplace')
export class MarketplaceRequestsController {
  private readonly logger = new Logger(MarketplaceRequestsController.name);

  constructor(
    private readonly requests: MarketplaceRequestsService,
    private readonly preflight: RequestPreflightService,
    private readonly stripe: StripeService,
  ) {}

  @Public()
  @Post('find-broker/preflight')
  async runPreflight(@Body() dto: CreateMarketplaceRequestDto) {
    return {
      success: true,
      data: await this.preflight.preflight(dto),
    };
  }

  @Get('requests')
  async list(@Req() req: Request, @Query() query: ListMarketplaceRequestsDto) {
    return {
      success: true,
      data: await this.requests.list(resolveRequestContext(req), query),
    };
  }

  @Post('requests')
  async create(
    @Req() req: Request,
    @Body() dto: CreateMarketplaceRequestDto,
  ) {
    return {
      success: true,
      data: await this.requests.create(resolveRequestContext(req), dto),
    };
  }

  @Get('requests/:id')
  async detail(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    return {
      success: true,
      data: await this.requests.getDetail(resolveRequestContext(req), id),
    };
  }

  @Post('requests/:id/match')
  async recomputeMatches(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return {
      success: true,
      data: await this.requests.recomputeMatches(resolveRequestContext(req), id),
    };
  }

  @Get('requests/:id/matches')
  async listMatches(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return {
      success: true,
      data: await this.requests.listMatchesForRequest(
        resolveRequestContext(req),
        id,
      ),
    };
  }

  @Get('requests/:id/quotes')
  async listQuotes(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return {
      success: true,
      data: await this.requests.listQuotesForRequest(
        resolveRequestContext(req),
        id,
      ),
    };
  }

  @Post('requests/:id/invite-brokers')
  async inviteBrokers(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { brokerProfileIds: string[] },
  ) {
    return {
      success: true,
      data: await this.requests.inviteBrokers(
        resolveRequestContext(req),
        id,
        body.brokerProfileIds ?? [],
      ),
    };
  }

  @Post('requests/:id/messages')
  async sendRequestMessage(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { brokerProfileId: string; body: string },
  ) {
    return {
      success: true,
      data: await this.requests.sendMessageOnRequest(
        resolveRequestContext(req),
        id,
        body.brokerProfileId,
        body.body,
      ),
    };
  }

  @Get('requests/:id/messages')
  async listRequestMessages(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('brokerProfileId') brokerProfileId?: string,
  ) {
    return {
      success: true,
      data: await this.requests.listMessagesForRequest(
        resolveRequestContext(req),
        id,
        brokerProfileId,
      ),
    };
  }

  @Public()
  @Get('search-facets')
  async searchFacets() {
    return {
      success: true,
      data: await this.requests.searchFacets(),
    };
  }

  @Post('requests/:id/close')
  async close(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    return {
      success: true,
      data: await this.requests.close(resolveRequestContext(req), id),
    };
  }

  @Post('quotes/:id/accept')
  async acceptQuote(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AcceptQuoteDto,
  ) {
    return {
      success: true,
      data: await this.requests.acceptQuote(
        resolveRequestContext(req),
        id,
        dto,
      ),
    };
  }

  @Get('conversations/:id/messages')
  async listMessages(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return {
      success: true,
      data: await this.requests.listMessages(resolveRequestContext(req), id),
    };
  }

  @Post('conversations/:id/messages')
  async sendMessage(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendMessageDto,
  ) {
    return {
      success: true,
      data: await this.requests.sendMessage(
        resolveRequestContext(req),
        id,
        dto,
      ),
    };
  }

  @Post('conversations/:id/consent')
  async consent(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConsentToFullPacketDto,
  ) {
    return {
      success: true,
      data: await this.requests.consentToFullPacket(
        resolveRequestContext(req),
        id,
        dto,
      ),
    };
  }

  /**
   * R1-A-02 — long-poll style endpoint returning messages newer than the
   * `since` cursor. UIs that prefer SSE use the /poll variant below; this
   * one is a plain GET for clients that can't sustain a streaming socket.
   */
  @Get('conversations/:id/messages/since')
  async messagesSince(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('since') since?: string,
  ) {
    const sinceDate = since ? new Date(since) : null;
    if (sinceDate && Number.isNaN(sinceDate.getTime())) {
      throw new BadRequestException('since must be an ISO timestamp');
    }
    return {
      success: true,
      data: await this.requests.pollMessages(
        resolveRequestContext(req),
        id,
        sinceDate,
      ),
    };
  }

  /**
   * R1-A-02 — Server-Sent Events stream of new messages. Polls the DB at a
   * fixed cadence (configurable via MARKETPLACE_POLL_INTERVAL_MS) and pushes
   * an event each tick. Stays open until the client disconnects; clients
   * should reconnect using the `since` cursor of the last event.
   */
  @Sse('conversations/:id/poll')
  pollStream(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('since') since?: string,
  ): Observable<MessageEvent> {
    const ctx = resolveRequestContext(req);
    const startCursor = since ? new Date(since) : null;
    if (startCursor && Number.isNaN(startCursor.getTime())) {
      throw new BadRequestException('since must be an ISO timestamp');
    }
    let cursor: Date | null = startCursor;
    const periodMs = Number(
      process.env.MARKETPLACE_POLL_INTERVAL_MS || 3_000,
    );
    return new Observable<MessageEvent>((subscriber) => {
      const sub = interval(periodMs)
        .pipe(
          map(async () => {
            const result = await this.requests.pollMessages(ctx, id, cursor);
            if (result.latest) cursor = result.latest;
            return result;
          }),
        )
        .subscribe({
          next: async (promise) => {
            try {
              const result = await promise;
              subscriber.next({ data: JSON.stringify(result) });
            } catch (err) {
              subscriber.error(err);
            }
          },
          error: (err) => subscriber.error(err),
          complete: () => subscriber.complete(),
        });
      return () => sub.unsubscribe();
    });
  }

  @Get('conversations/:id/messages/:messageId/attachments/sign')
  async signAttachment(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Query('storageKey') storageKey?: string,
  ) {
    if (!storageKey) {
      throw new BadRequestException('storageKey is required');
    }
    return {
      success: true,
      data: await this.requests.signMessageAttachment(
        resolveRequestContext(req),
        id,
        messageId,
        storageKey,
      ),
    };
  }

  /**
   * R1-B-01 — broker rescinds an accepted quote. If the rescission is
   * inside the configurable window the relationship is paused and the
   * draft entry is cancelled; outside the window the broker must contact
   * the business directly (we record the request but don't auto-undo).
   */
  /**
   * R1-D-04 — consent toggle timeline for a conversation.
   */
  @Get('conversations/:id/consent/history')
  async consentHistory(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return {
      success: true,
      data: await this.requests.getConsentHistory(
        resolveRequestContext(req),
        id,
      ),
    };
  }

  /**
   * R1-A-03 — caller bumps their own lastReadAt cursor on a conversation.
   * Optional `at` body field lets clients pass the timestamp of the last
   * message they've actually rendered (avoids racing the server clock).
   */
  @Post('conversations/:id/read')
  async markRead(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { at?: string },
  ) {
    const at = body?.at ? new Date(body.at) : null;
    if (at && Number.isNaN(at.getTime())) {
      throw new BadRequestException('at must be an ISO timestamp');
    }
    return {
      success: true,
      data: await this.requests.markConversationRead(
        resolveRequestContext(req),
        id,
        at,
      ),
    };
  }

  /**
   * R1-A-03 — unread badge feed for the caller. Returns per-conversation
   * unread counts plus a total to badge the inbox icon.
   */
  @Get('conversations/unread')
  async unreadCounts(@Req() req: Request) {
    return {
      success: true,
      data: await this.requests.unreadCounts(resolveRequestContext(req)),
    };
  }

  /**
   * R1-B-04 — start a concierge intake. Authenticated business calls this
   * to create a draft request + Stripe checkout URL. The webhook below
   * promotes the request to `priority='concierge'` once payment lands.
   */
  @Post('find-broker/concierge')
  async startConciergeIntake(
    @Req() req: Request,
    @Body() dto: CreateMarketplaceRequestDto,
  ) {
    return {
      success: true,
      data: await this.requests.startConciergeIntake(
        resolveRequestContext(req),
        dto,
      ),
    };
  }

  /**
   * R1-B-04 — Stripe webhook receiver for marketplace-specific events.
   * Registered separately from the billing webhook so we can scope the
   * subset of events we handle (concierge checkout) without coupling
   * billing to marketplace. Stripe should be configured with the
   * MARKETPLACE_STRIPE_WEBHOOK_SECRET signing secret pointed at this URL.
   */
  @Public()
  @Post('stripe-webhook')
  @HttpCode(200)
  async stripeWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    const secret = process.env.MARKETPLACE_STRIPE_WEBHOOK_SECRET || '';
    if (!secret) {
      throw new BadRequestException(
        'MARKETPLACE_STRIPE_WEBHOOK_SECRET is not configured',
      );
    }
    if (!req.rawBody) {
      throw new BadRequestException('rawBody required for Stripe signature');
    }
    let event;
    try {
      event = this.stripe.verifyWebhookSignature(
        req.rawBody,
        signature,
        secret,
      );
    } catch (err) {
      this.logger.warn(
        `Stripe signature verify failed: ${(err as Error).message}`,
      );
      throw new BadRequestException('Invalid stripe signature');
    }
    if (event.type !== 'checkout.session.completed') {
      return { received: true, ignored: event.type };
    }
    const session = event.data.object as any;
    const flow = session?.metadata?.flow;
    const requestId =
      session?.metadata?.marketplaceRequestId || session?.client_reference_id;
    const paymentIntentId =
      typeof session?.payment_intent === 'string'
        ? session.payment_intent
        : session?.payment_intent?.id;
    if (flow === 'pro_subscription') {
      const profileId =
        session?.metadata?.brokerProfileId || session?.client_reference_id;
      if (profileId) {
        // Stripe subscriptions don't include a hard-coded end timestamp on
        // the session payload; we read current_period_end off the
        // subscription if Stripe expanded it, otherwise rely on the
        // subscription.updated webhook to land later.
        const subscription =
          typeof session?.subscription === 'object'
            ? session.subscription
            : null;
        const activeUntil =
          subscription?.current_period_end
            ? new Date(subscription.current_period_end * 1000)
            : null;
        try {
          await this.requests.promoteProSubscription(profileId, activeUntil);
        } catch (err) {
          this.logger.error(
            `Pro promotion failed for profile ${profileId}: ${(err as Error).message}`,
          );
        }
      }
      return { received: true };
    }
    if (flow !== 'concierge_intake' || !requestId) {
      return { received: true, ignored: 'not_known_flow' };
    }
    try {
      await this.requests.promoteConciergeRequest(
        requestId,
        paymentIntentId ?? 'unknown',
      );
    } catch (err) {
      // Swallow + log so Stripe doesn't retry forever on a missing draft;
      // manual recovery via /admin/marketplace/requests is always possible.
      this.logger.error(
        `Concierge promotion failed for request ${requestId}: ${(err as Error).message}`,
      );
    }
    return { received: true };
  }

  /**
   * R2-D-01 — broker subscribes their profile to Pro tier. Returns the
   * Stripe checkout URL the UI redirects to.
   */
  @Post('pro/subscribe')
  async startProSubscription(@Req() req: Request) {
    return {
      success: true,
      data: await this.requests.startProSubscription(
        resolveRequestContext(req),
      ),
    };
  }

  /**
   * R2-D-05 — broker win-rate by commodity chapter over the last N days.
   */
  @Get('broker/win-rate-by-commodity')
  async winRateByCommodity(
    @Req() req: Request,
    @Query('days') days?: string,
  ) {
    const ctx = resolveRequestContext(req);
    return {
      success: true,
      data: await this.requests.winRateByCommodity(
        ctx.organizationId,
        days ? Number(days) : undefined,
      ),
    };
  }

  @Post('quotes/:id/rescind')
  async rescindQuote(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { reason?: string },
  ) {
    return {
      success: true,
      data: await this.requests.rescindQuote(
        resolveRequestContext(req),
        id,
        body?.reason ?? null,
      ),
    };
  }
}


@Controller('marketplace/broker')
export class MarketplaceBrokerLeadsController {
  constructor(private readonly requests: MarketplaceRequestsService) {}

  @Get('leads')
  async list(@Req() req: Request) {
    return {
      success: true,
      data: await this.requests.listBrokerLeads(resolveRequestContext(req)),
    };
  }

  @Get('leads/:matchId')
  async detail(
    @Req() req: Request,
    @Param('matchId', ParseUUIDPipe) matchId: string,
  ) {
    return {
      success: true,
      data: await this.requests.getBrokerLead(
        resolveRequestContext(req),
        matchId,
      ),
    };
  }

  @Post('leads/:matchId/decline')
  async decline(
    @Req() req: Request,
    @Param('matchId', ParseUUIDPipe) matchId: string,
    @Body() dto: DeclineLeadDto,
  ) {
    return {
      success: true,
      data: await this.requests.declineLead(
        resolveRequestContext(req),
        matchId,
        dto,
      ),
    };
  }

  @Post('leads/:matchId/quote')
  async submitQuote(
    @Req() req: Request,
    @Param('matchId', ParseUUIDPipe) matchId: string,
    @Body() dto: CreateQuoteDto,
  ) {
    return {
      success: true,
      data: await this.requests.submitQuote(
        resolveRequestContext(req),
        matchId,
        dto,
      ),
    };
  }
}
