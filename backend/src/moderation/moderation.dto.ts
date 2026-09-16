import { Equals, IsIn, IsInt, IsString, Matches, MaxLength, Min, ValidateIf } from 'class-validator';
import { SocialPageDto } from '../social/social.dto';

export const REPORT_DISCLOSURE_VERSION = '2026-09-16';
export class CreateReviewReportDto {
  @IsInt() @Min(1) expectedRevision: number;
  @IsString() @MaxLength(1000) @Matches(/\S/u) reason: string;
  @Equals(true) acceptDisclosure: boolean;
  @Equals(REPORT_DISCLOSURE_VERSION) disclosureVersion: string;
}
export class ModerationQueryDto extends SocialPageDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(['pending', 'upheld', 'dismissed']) status?: string;
}
export class DecideReviewReportDto {
  @IsIn(['upheld', 'dismissed']) status: string;
  @IsString() @MaxLength(1000) @Matches(/\S/u) reason: string;
}
