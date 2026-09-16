import { IsIn, IsInt, IsISO8601, IsString, Matches, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { CLASSIFICATION_KINDS, ClassificationKind } from './ledger-semantics';

export class LedgerSummaryQueryDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startDate: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  endDate: string;
}

export class ClassifyBillDto {
  @IsIn(CLASSIFICATION_KINDS)
  kind: ClassificationKind;

  @IsIn(['CNY'])
  currency: 'CNY';

  @IsISO8601({ strict: true })
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/)
  expectedUpdatedAt: string;
}

export class LedgerPendingQueryDto extends LedgerSummaryQueryDto {
  @Type(() => Number) @IsInt() @Min(0) afterId = 0;
}
