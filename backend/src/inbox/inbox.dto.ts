import { Type } from 'class-transformer';
import { IsInt, IsString, Max, MaxLength, Min } from 'class-validator';

export class InboxQueryDto {
  @Type(() => Number) @IsInt() @Min(0) @Max(2147483647) after = 0;
  @Type(() => Number) @IsInt() @Min(1) @Max(50) limit = 20;
}
export class ReadInboxDto {
  @IsString() @MaxLength(12000) receipt: string;
}
