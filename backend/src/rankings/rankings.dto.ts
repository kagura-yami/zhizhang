import { IsIn, IsString, MaxLength } from 'class-validator';
import { SocialPageDto } from '../social/social.dto';
import { RankingKind } from './ranking-period';

export class RankingPeriodsQuery extends SocialPageDto {
  @IsIn(['day', 'month', 'year']) kind: RankingKind = 'month';
}
export class RankingQuery extends RankingPeriodsQuery {
  @IsString() @MaxLength(10) period: string;
  @IsIn(['global', 'friends']) scope: 'global' | 'friends' = 'global';
}
