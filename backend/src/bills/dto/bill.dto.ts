import {
  IsString,
  IsNumber,
  IsOptional,
  IsDateString,
  IsEnum,
  IsPositive,
  Min,
  Max,
  IsNotEmpty,
  IsIn,
  MaxLength,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export enum BillType {
  INCOME = 'income',
  EXPENSE = 'expense',
}

export class CreateBillDto {
  @ApiProperty({
    description: '账单金额',
    example: 100.5,
    minimum: 0.01,
  })
  @IsNotEmpty({ message: '金额不能为空' })
  @IsNumber({}, { message: '金额必须是数字' })
  @IsPositive({ message: '金额必须大于0' })
  @Transform(({ value }) => parseFloat(value))
  amount: number;

  @ApiProperty({
    description: '账单类型',
    example: 'expense',
    enum: ['income', 'expense'],
  })
  @IsEnum(BillType, { message: '类型必须是income或expense' })
  type: BillType;

  @ApiProperty({
    description: '账单描述',
    example: '午餐费用',
    required: false,
    maxLength: 500,
  })
  @IsOptional()
  @IsString({ message: '描述必须是字符串' })
  @MaxLength(500, { message: '描述长度不能超过500个字符' })
  description?: string;

  @ApiProperty({
    description: '账单日期',
    example: '2024-01-15',
    format: 'date',
  })
  @IsDateString({}, { message: '日期格式不正确' })
  date: string;

  @ApiProperty({
    description: '交易发生的具体时间',
    example: '2026-08-19T10:30:00.000Z',
    required: false,
  })
  @IsOptional()
  @IsDateString({}, { message: '交易时间格式不正确' })
  time?: string;

  @ApiProperty({ description: '支付渠道', example: '微信支付', required: false })
  @IsOptional()
  @IsString({ message: '支付渠道必须是字符串' })
  @MaxLength(50, { message: '支付渠道长度不能超过50个字符' })
  paymentChannel?: string;

  @ApiProperty({ description: '交易对象或商户', example: '某某便利店', required: false })
  @IsOptional()
  @IsString({ message: '交易对象必须是字符串' })
  @MaxLength(200, { message: '交易对象长度不能超过200个字符' })
  counterparty?: string;

  @ApiProperty({
    description: '记账方式',
    enum: ['manual', 'voice', 'ocr', 'text', 'notification'],
    required: false,
  })
  @IsOptional()
  @IsIn(['manual', 'voice', 'ocr', 'text', 'notification'], { message: '记账方式不正确' })
  source?: string;

  @ApiProperty({ description: '自动记账来源应用', example: 'wechat', required: false })
  @IsOptional()
  @IsString({ message: '自动记账来源应用必须是字符串' })
  @MaxLength(50, { message: '自动记账来源应用长度不能超过50个字符' })
  sourceApp?: string;

  @ApiProperty({
    description: '分类ID',
    example: 1,
    required: false,
  })
  @IsOptional()
  @IsNumber({}, { message: '分类ID必须是数字' })
  categoryId?: number;
}

// 内部使用的完整DTO，包含userId
export class CreateBillWithUserDto extends CreateBillDto {
  userId: string;
}

export class UpdateBillDto {
  @ApiProperty({ description: '账单金额', example: 100.5, required: false })
  @IsOptional()
  @IsNumber({}, { message: '金额必须是数字' })
  @IsPositive({ message: '金额必须大于0' })
  @Transform(({ value }) => (value ? parseFloat(value) : undefined))
  amount?: number;

  @ApiProperty({
    description: '账单类型',
    enum: ['income', 'expense'],
    required: false,
  })
  @IsOptional()
  @IsEnum(BillType, { message: '类型必须是income或expense' })
  type?: BillType;

  @ApiProperty({
    description: '账单描述',
    example: '午餐费用',
    required: false,
  })
  @IsOptional()
  @IsString({ message: '描述必须是字符串' })
  @MaxLength(500, { message: '描述长度不能超过500个字符' })
  description?: string;

  @ApiProperty({
    description: '账单日期',
    example: '2024-01-15',
    required: false,
  })
  @IsOptional()
  @IsDateString({}, { message: '日期格式不正确' })
  date?: string;

  @ApiProperty({ description: '交易发生的具体时间', required: false })
  @IsOptional()
  @IsDateString({}, { message: '交易时间格式不正确' })
  time?: string;

  @ApiProperty({ description: '支付渠道', required: false })
  @IsOptional()
  @IsString({ message: '支付渠道必须是字符串' })
  @MaxLength(50, { message: '支付渠道长度不能超过50个字符' })
  paymentChannel?: string;

  @ApiProperty({ description: '交易对象或商户', required: false })
  @IsOptional()
  @IsString({ message: '交易对象必须是字符串' })
  @MaxLength(200, { message: '交易对象长度不能超过200个字符' })
  counterparty?: string;

  @ApiProperty({ description: '分类ID', example: 1, required: false })
  @IsOptional()
  @IsNumber({}, { message: '分类ID必须是数字' })
  categoryId?: number;
}

export class BillQueryDto {
  @ApiProperty({ description: '页码', example: 1, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: '页码必须是数字' })
  @Min(1, { message: '页码必须大于0' })
  page?: number = 1;

  @ApiProperty({ description: '每页数量', example: 20, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: '每页数量必须是数字' })
  @Min(1, { message: '每页数量必须大于0' })
  @Max(100, { message: '每页数量不能超过100' })
  limit?: number = 20;

  @ApiProperty({
    description: '账单类型',
    enum: ['income', 'expense'],
    required: false,
  })
  @IsOptional()
  @IsEnum(BillType, { message: '类型必须是income或expense' })
  type?: BillType;

  @ApiProperty({ description: '分类ID', example: 1, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: '分类ID必须是数字' })
  categoryId?: number;

  @ApiProperty({
    description: '开始日期',
    example: '2024-01-01',
    required: false,
  })
  @IsOptional()
  @IsDateString({}, { message: '开始日期格式不正确' })
  startDate?: string;

  @ApiProperty({
    description: '结束日期',
    example: '2024-01-31',
    required: false,
  })
  @IsOptional()
  @IsDateString({}, { message: '结束日期格式不正确' })
  endDate?: string;

  @ApiProperty({
    description: '排序字段',
    enum: ['date', 'amount', 'createdAt'],
    required: false,
  })
  @IsOptional()
  @IsString({ message: '排序字段必须是字符串' })
  @IsIn(['date', 'amount', 'createdAt'], {
    message: '排序字段只能是date、amount或createdAt',
  })
  orderBy?: string = 'date';

  @ApiProperty({
    description: '排序方向',
    enum: ['asc', 'desc'],
    required: false,
  })
  @IsOptional()
  @IsIn(['asc', 'desc'], { message: '排序方向必须是asc或desc' })
  orderDirection?: 'asc' | 'desc' = 'desc';
}
