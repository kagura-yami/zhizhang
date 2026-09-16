import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class CreateRetrospectiveDto {
  @IsUUID() clientKey: string;
  @IsIn(['day', 'month']) kind: 'day' | 'month';
  @IsString() @MaxLength(10) period: string;
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(1)
  configId?: number;
}
export class RetrospectivePageDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(10000) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(50) pageSize = 20;
}
