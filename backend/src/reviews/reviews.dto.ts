import { IsIn, IsInt, IsString, IsUUID, Matches, MaxLength, Min, ValidateIf } from 'class-validator';
import { SocialPageDto } from '../social/social.dto';

export class VoteDto {
  @IsIn(['hang', 'la']) vote: string;
}
export class ReviewPageDto extends SocialPageDto {}
export class NewReviewMessageDto {
  @IsUUID() clientKey: string;
  @IsString() @MaxLength(2000) @Matches(/\S/u) body: string;
}
export class ChangeReviewMessageDto {
  @IsInt() @Min(1) expectedRevision: number;
  @IsIn(['edit', 'withdraw', 'restore']) action: string;
  @ValidateIf((object, value) => object.action === 'edit' || value !== undefined)
  @IsString() @MaxLength(2000) @Matches(/\S/u) body?: string;
}
