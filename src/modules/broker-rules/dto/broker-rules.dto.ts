import { IsBoolean, IsIn, IsObject, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class UpsertRuleDto {
  @IsString()
  @Length(2, 80)
  code: string;

  @IsString()
  @Length(2, 200)
  title: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsIn(['system', 'organization', 'client'])
  scope: 'system' | 'organization' | 'client';

  @IsOptional()
  @IsUUID('4')
  clientId?: string | null;

  @IsIn(['info', 'warning', 'blocker'])
  severity: 'info' | 'warning' | 'blocker';

  @IsIn([
    'required_field',
    'hts_format',
    'country_of_origin',
    'unit_of_measure',
    'value_threshold',
    'poa_required',
    'docs_required',
    'policy_exposure',
  ])
  ruleType:
    | 'required_field'
    | 'hts_format'
    | 'country_of_origin'
    | 'unit_of_measure'
    | 'value_threshold'
    | 'poa_required'
    | 'docs_required'
    | 'policy_exposure';

  @IsObject()
  config: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class AcknowledgeIssueDto {
  @IsIn(['acknowledged', 'resolved', 'suppressed'])
  status: 'acknowledged' | 'resolved' | 'suppressed';

  @IsOptional()
  @IsString()
  note?: string;
}
