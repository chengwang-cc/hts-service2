import { Injectable } from '@nestjs/common';
import { Section301ListLoader } from './helpers/section301-list-loader';
import { Section301ListRuleBase } from './section301-list.base';

/**
 * Rule: us.section301.cn-list1
 * Authority: Section 301 of the Trade Act of 1974
 * Scope: 818 HTS codes on USTR List 1 from CN origin.
 * Effective from: 2018-07-06; 25% additional under Chapter 99 9903.88.01.
 * Sources: fr.notice.83-28710 (USTR List 1), cbp.csms.18-000390
 */
@Injectable()
export class Section301List1Rule extends Section301ListRuleBase {
  readonly id = 'us.section301.cn-list1';
  readonly title = 'Section 301 — China List 1 (25%)';
  readonly priority = 2500;
  readonly knowledgeCardKeys = ['fr.notice.83-28710', 'cbp.csms.18-000390'];
  protected readonly listId = '1' as const;
  constructor(loader: Section301ListLoader) { super(loader); }
}
