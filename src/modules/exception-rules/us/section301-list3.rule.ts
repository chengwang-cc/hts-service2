import { Injectable } from '@nestjs/common';
import { Section301ListLoader } from './helpers/section301-list-loader';
import { Section301ListRuleBase } from './section301-list.base';

/**
 * Rule: us.section301.cn-list3
 * Effective from: 2018-09-24 (10%), raised to 25% on 2019-05-10.
 * Chapter 99: 9903.88.03.
 * Sources: fr.notice.83-47974, fr.notice.84-20459, cbp.csms.18-000554
 */
@Injectable()
export class Section301List3Rule extends Section301ListRuleBase {
  readonly id = 'us.section301.cn-list3';
  readonly title = 'Section 301 — China List 3 (25%)';
  readonly priority = 2520;
  readonly knowledgeCardKeys = [
    'fr.notice.83-47974',
    'fr.notice.84-20459',
    'cbp.csms.18-000554',
  ];
  protected readonly listId = '3' as const;
  constructor(loader: Section301ListLoader) { super(loader); }
}
