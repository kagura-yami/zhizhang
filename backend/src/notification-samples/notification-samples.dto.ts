import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

export class NotificationSampleDto {
  @IsString() @MinLength(1) @MaxLength(64) sampleId: string;
  @IsString() @MinLength(1) @MaxLength(200) packageName: string;
  @IsString() @MaxLength(30) appVersion: string;
  @IsString() @MaxLength(50) ruleVersion: string;
  @IsDateString() postedAt: string;
  @IsDateString() capturedAt: string;
  @IsIn(['queued', 'deduplicated', 'ignored', 'error']) status: string;
  @IsString() @MaxLength(200) reason: string;
  @IsObject() raw: Record<string, unknown>;
  @IsOptional() @IsObject() parsed?: Record<string, unknown>;
}
export class UploadNotificationSamplesDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(25)
  @ValidateNested({ each: true }) @Type(() => NotificationSampleDto)
  samples: NotificationSampleDto[];
}
export class NotificationSampleQueryDto {
  @IsOptional() @IsUUID() userId?: string;
  @IsOptional() @IsString() @MaxLength(200) packageName?: string;
  @IsOptional() @IsString() @MaxLength(50) ruleVersion?: string;
  @IsOptional() @IsIn(['queued', 'deduplicated', 'ignored', 'error']) status?: string;
  @Type(() => Number) @IsInt() @Min(1) @IsOptional() page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) @IsOptional() pageSize = 20;
  @Type(() => Number) @IsInt() @Min(0) @IsOptional() afterId = 0;
}
