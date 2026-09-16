import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsInt, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';

export class InboxQueryDto {
  @ValidateIf((_object, value) => value !== undefined)
  @Type(() => Number) @IsInt() @Min(1) @Max(2147483647) before?: number;
  @Type(() => Number) @IsInt() @Min(0) @Max(2147483647) after = 0;
  @Type(() => Number) @IsInt() @Min(1) @Max(50) limit = 20;
}
export class ReadInboxDto {
  @IsString() @MaxLength(12000) receipt: string;
}
export class BillFeedbackDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ArrayUnique()
  @IsInt({ each: true }) @Min(1, { each: true }) @Max(2147483647, { each: true }) billIds: number[];
}
