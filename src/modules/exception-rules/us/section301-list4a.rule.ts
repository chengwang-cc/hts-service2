import { Injectable } from '@nestjs/common';
import { Section301ListLoader } from './helpers/section301-list-loader';
import { Section301ListRuleBase } from './section301-list.base';

/**
 * Rule: us.section301.cn-list4a
 * Effective from: 2019-09-01 (15%), reduced to 7.5% on 2020-02-14.
 * Chapter 99: 9903.88.15.
 * Sources: fr.notice.84-43304, fr.notice.85-3741, cbp.csms.19-000457
 */
@Injectable()
export class Section301List4ARule extends Section301ListRuleBase {
  readonly id = 'us.section301.cn-list4a';
  readonly title = 'Section 301 — China List 4A (7.5%)';
  readonly priority = 2530;
  readonly knowledgeCardKeys = [
    'fr.notice.84-43304',
    'fr.notice.85-3741',
    'cbp.csms.19-000457',
  ];
  protected readonly listId = '4A' as const;
  constructor(loader: Section301ListLoader) { super(loader); }
}
