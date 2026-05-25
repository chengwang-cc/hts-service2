import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditService } from '../../audit/services/audit.service';
import { RequestContext } from '../../auth/interfaces/request-context.interface';
import {
  ConsumeCreditsDto,
  GrantCreditsDto,
} from '../dto/marketplace-reviews.dto';
import {
  BrokerCreditBalanceEntity,
  BrokerCreditLedgerEntity,
} from '../entities';

@Injectable()
export class BrokerCreditsService {
  constructor(
    @InjectRepository(BrokerCreditBalanceEntity)
    private readonly balances: Repository<BrokerCreditBalanceEntity>,
    @InjectRepository(BrokerCreditLedgerEntity)
    private readonly ledger: Repository<BrokerCreditLedgerEntity>,
    private readonly audit: AuditService,
  ) {}

  async getBalance(organizationId: string) {
    const existing = await this.balances.findOne({
      where: { organizationId },
    });
    if (existing) return existing;
    return this.balances.save(
      this.balances.create({
        organizationId,
        leadCredits: 0,
        conciergeCredits: 0,
      }),
    );
  }

  async grant(ctx: RequestContext, dto: GrantCreditsDto) {
    if (!ctx.userId) throw new ForbiddenException('Authenticated context required');
    const balance = await this.getBalance(dto.organizationId);
    if (dto.creditType === 'lead') {
      balance.leadCredits += dto.amount;
    } else {
      balance.conciergeCredits += dto.amount;
    }
    await this.balances.save(balance);
    await this.ledger.save(
      this.ledger.create({
        organizationId: dto.organizationId,
        creditType: dto.creditType,
        delta: dto.amount,
        eventType: dto.eventType,
        description: dto.description ?? null,
        initiatedByUserId: ctx.userId,
      }),
    );
    await this.audit.record({
      eventType: 'broker_credits.granted',
      organizationId: dto.organizationId,
      actorUserId: ctx.userId,
      resourceType: 'broker_credit_balance',
      resourceId: balance.id,
      source: 'admin',
      metadata: {
        creditType: dto.creditType,
        amount: dto.amount,
        eventType: dto.eventType,
      },
    });
    return balance;
  }

  async consume(ctx: RequestContext, dto: ConsumeCreditsDto) {
    if (!ctx.organizationId) throw new ForbiddenException('Authenticated context required');
    const balance = await this.getBalance(ctx.organizationId);
    const current =
      dto.creditType === 'lead'
        ? balance.leadCredits
        : balance.conciergeCredits;
    if (current < dto.amount) {
      throw new BadRequestException(
        `Insufficient ${dto.creditType} credits: have ${current}, need ${dto.amount}`,
      );
    }
    if (dto.creditType === 'lead') {
      balance.leadCredits -= dto.amount;
    } else {
      balance.conciergeCredits -= dto.amount;
    }
    await this.balances.save(balance);
    await this.ledger.save(
      this.ledger.create({
        organizationId: ctx.organizationId,
        creditType: dto.creditType,
        delta: -dto.amount,
        eventType: dto.eventType,
        description: dto.description ?? null,
        initiatedByUserId: ctx.userId,
      }),
    );
    await this.audit.record({
      eventType: 'broker_credits.consumed',
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      resourceType: 'broker_credit_balance',
      resourceId: balance.id,
      source: 'broker-credits',
      metadata: {
        creditType: dto.creditType,
        amount: dto.amount,
        eventType: dto.eventType,
      },
    });
    return balance;
  }

  async ledgerFor(organizationId: string) {
    return this.ledger.find({
      where: { organizationId },
      order: { createdAt: 'DESC' },
      take: 200,
    });
  }
}
