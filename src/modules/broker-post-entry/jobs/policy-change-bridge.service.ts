import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BrokerEntryEntity } from '../../broker-entries/entities/broker-entry.entity';
import { QueueService } from '../../queue/queue.service';
import { BrokerPostEntryService } from '../services/broker-post-entry.service';

export const POLICY_CHANGE_BRIDGE_QUEUE = 'broker.policy_change.bridge';

export interface PolicyChangeEvent {
  affectedHts: string[];
  eventSummary: string;
  /** Optional explicit org list; when omitted the bridge scans every
   *  broker org that has at least one matching entry. */
  organizationIds?: string[];
}

/**
 * R2-E-04 — bridges policy-change events into post-entry case creation.
 *
 * Subscribers fire `queue.sendJob('broker.policy_change.bridge', event)`
 * (typically from a policy-change-monitor module living elsewhere); this
 * worker dispatches `flagEntriesAffectedByPolicyChange()` per affected
 * broker org. Admins can also POST the event directly via
 * `/admin/broker/policy-change/dispatch` for manual remediation.
 */
@Injectable()
export class PolicyChangeBridge implements OnModuleInit {
  private readonly logger = new Logger(PolicyChangeBridge.name);

  constructor(
    @InjectRepository(BrokerEntryEntity)
    private readonly entries: Repository<BrokerEntryEntity>,
    @Optional() private readonly queue: QueueService | null,
    private readonly postEntry: BrokerPostEntryService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.queue) return;
    await this.queue.registerHandler(
      POLICY_CHANGE_BRIDGE_QUEUE,
      async (job) => {
        await this.handle(job.data as PolicyChangeEvent);
      },
      { teamSize: 1, teamConcurrency: 2 },
    );
  }

  async handle(event: PolicyChangeEvent): Promise<void> {
    // The post-entry service flags by HTS prefix; we dispatch one call per
    // (org × prefix). When organizationIds is omitted we derive the set
    // from any entry currently using one of the affected HTS numbers.
    const orgs = event.organizationIds?.length
      ? event.organizationIds
      : await this.resolveAffectedOrgs(event.affectedHts);
    let totalCreated = 0;
    for (const org of orgs) {
      for (const hts of event.affectedHts) {
        const result = await this.postEntry.flagEntriesAffectedByPolicyChange(
          hts,
          org,
        );
        totalCreated += result.created ?? 0;
      }
    }
    this.logger.log(
      `Policy change "${event.eventSummary}" opened ${totalCreated} case(s) across ${orgs.length} org(s)`,
    );
  }

  private async resolveAffectedOrgs(affectedHts: string[]): Promise<string[]> {
    if (!affectedHts.length) return [];
    const rows = await this.entries
      .createQueryBuilder('e')
      .innerJoin('broker_entry_lines', 'l', 'l.entry_id = e.id')
      .where('l.hts_number IN (:...nums)', { nums: affectedHts })
      .select('DISTINCT e.broker_organization_id', 'org')
      .getRawMany();
    return rows.map((r) => r.org).filter(Boolean);
  }
}
