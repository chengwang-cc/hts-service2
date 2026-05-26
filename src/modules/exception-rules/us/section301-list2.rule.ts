import { Injectable } from '@nestjs/common';
import { Section301ListLoader } from './helpers/section301-list-loader';
import { Section301ListRuleBase } from './section301-list.base';

/**
 * Rule: us.section301.cn-list2
 * Effective from: 2018-08-23; 25% under 9903.88.02.
 * Sources: fr.notice.83-40823, cbp.csms.18-000489
 */
@Injectable()
export class Section301List2Rule extends Section301ListRuleBase {
  readonly id = 'us.section301.cn-list2';
  readonly title = 'Section 301 — China List 2 (25%)';
  readonly priority = 2510;
  readonly knowledgeCardKeys = ['fr.notice.83-40823', 'cbp.csms.18-000489'];
  protected readonly listId = '2' as const;
  constructor(loader: Section301ListLoader) { super(loader); }
}
