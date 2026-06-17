/**
 * Managed lookup for manual credit adjustment reasons. The admin UI
 * renders a dropdown of these; free-text reasons are NOT accepted on
 * the wire — the design doc spells out why (auditors need structured
 * reason codes, reports group by them, Oracle-style enum lookup is
 * the industry pattern).
 *
 * To add a new reason: append here, then ship a SPA update that
 * surfaces it in the dropdown. The validator class-level enum
 * matches this list exactly.
 *
 * Source: docs/2026-06-17/0736_financial-management-system-design.md §7.2
 */
export const MANUAL_ADJUSTMENT_REASON_CODES = [
  'GOODWILL',
  'SLA_VIOLATION',
  'BETA_GRANT',
  'SUPPORT_RESOLUTION',
  'BILLING_ERROR_CORRECTION',
  'PROMO',
  'MIGRATION',
  'MANUAL_REFUND_RECOVERY',
] as const;

export type ManualAdjustmentReasonCode =
  (typeof MANUAL_ADJUSTMENT_REASON_CODES)[number];
