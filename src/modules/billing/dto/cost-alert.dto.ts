import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
} from 'class-validator';

/**
 * Body for `PUT /api/v1/portal/cost-alert` — upsert the org's threshold.
 *
 * `thresholdUsd` is bounded at the upper end purely as a sanity guard —
 * a $1M monthly threshold is almost certainly a typo and we'd rather
 * 400 than silently never fire.
 *
 * `webhookUrl` is optional; if omitted, `channels` must be ['in_app'].
 * Service layer enforces the cross-field rule (class-validator's
 * cross-field support is awkward; cheaper to validate in the service).
 */
export class UpsertCostAlertDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(1_000_000)
  thresholdUsd: number;

  @IsArray()
  @IsIn(['in_app', 'webhook'], { each: true })
  channels: Array<'in_app' | 'webhook'>;

  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['https'] })
  @IsString()
  webhookUrl?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
