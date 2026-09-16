import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';

export const SOCIAL_CONSENT_VERSION = '2026-09-16';

export class SocialPreferencesDto {
  @ValidateIf((_object, value) => value !== undefined) @IsBoolean() allowAiFeedback?: boolean;
  @ValidateIf((_object, value) => value !== undefined) @IsBoolean() publicRelations?: boolean;
  @ValidateIf((_object, value) => value !== undefined) @IsIn(['none', 'friends', 'global']) rankingScope?: string;
  @ValidateIf((_object, value) => value !== undefined) @IsBoolean() showRankingAmount?: boolean;
  @ValidateIf((_object, value) => value !== undefined) @IsBoolean() notifyNewBills?: boolean;
  @ValidateIf((_object, value) => value !== undefined) @IsBoolean() notifyInteractions?: boolean;
  @ValidateIf((_object, value) => value !== undefined) @IsBoolean() notificationPreview?: boolean;
}

export class EnableSocialDto extends SocialPreferencesDto {
  @IsIn([SOCIAL_CONSENT_VERSION]) consentVersion: string;
}

export class SocialPageDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(10000) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(50) pageSize = 20;
}

export class SearchSocialDto extends SocialPageDto {
  @IsString() @MaxLength(100) query: string;
}

export class SaveGrantDto {
  @IsIn(['income', 'expense', 'both']) scope: string;
  // null explicitly disables historical visibility; omitted means new-bills-only too.
  @ValidateIf((_object, value) => value != null)
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  historyStart?: string | null;
  @ValidateIf((_object, value) => value !== undefined) @IsInt() @Min(1) expectedVersion?: number;
}

export class RequestVersionDto {
  @IsInt() @Min(1) expectedVersion: number;
}

export class SubmitRequestDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt() @Min(1) expectedVersion?: number;
}

export class ApproveRequestDto extends RequestVersionDto {
  @IsIn(['income', 'expense', 'both']) scope: string;
  @ValidateIf((_object, value) => value != null)
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  historyStart?: string | null;
}
