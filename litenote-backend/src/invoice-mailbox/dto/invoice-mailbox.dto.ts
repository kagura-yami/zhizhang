import { IsBoolean, IsDateString, IsEmail, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

export const INVOICE_MAILBOX_PROVIDERS = ['qq', '163', 'outlook', 'gmail', 'custom'] as const;
export type InvoiceMailboxProvider = (typeof INVOICE_MAILBOX_PROVIDERS)[number];

export class SaveInvoiceMailboxDto {
  @IsEmail({}, { message: '收票邮箱格式不正确' })
  @MaxLength(200)
  email: string;

  @IsIn(INVOICE_MAILBOX_PROVIDERS, { message: '暂不支持该邮箱服务商' })
  provider: InvoiceMailboxProvider;

  @IsString()
  @MaxLength(255)
  @IsOptional()
  imapHost?: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  @IsOptional()
  @Type(() => Number)
  imapPort?: number;

  @IsBoolean()
  @IsOptional()
  secure?: boolean;

  @IsEmail({}, { message: 'IMAP 登录账号格式不正确' })
  @MaxLength(200)
  @IsOptional()
  username?: string;

  @IsString({ message: '请输入邮箱授权码' })
  @MaxLength(300)
  credential: string;
}

export class InvoiceMailboxQueryDto {
  @IsString()
  @IsOptional()
  search?: string;

  @IsString()
  @IsOptional()
  buyer?: string;

  @IsString()
  @IsOptional()
  seller?: string;

  @IsIn(['matched', 'unmatched'])
  @IsOptional()
  status?: 'matched' | 'unmatched';

  @IsDateString()
  @IsOptional()
  from?: string;

  @IsDateString()
  @IsOptional()
  to?: string;

  @IsString()
  @IsOptional()
  ids?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  page = 1;

  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  @Type(() => Number)
  limit = 50;
}
