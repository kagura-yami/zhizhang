import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class AdminLoginDto {
  @IsString()
  @IsNotEmpty()
  username: string;

  @IsString()
  @IsNotEmpty()
  password: string;
}

export class AdminListQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  pageSize = 20;

  @IsString()
  @IsOptional()
  search?: string;
}

export class AdminUserQueryDto extends AdminListQueryDto {
  @IsIn(['all', 'active', 'disabled'])
  @IsOptional()
  status = 'all';
}

export class CreateAdminUserDto {
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  username: string;

  @IsString()
  @MinLength(6)
  @MaxLength(100)
  password: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @MaxLength(50)
  @IsOptional()
  nickname?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class UpdateAdminUserDto {
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  @IsOptional()
  username?: string;

  @IsString()
  @MinLength(6)
  @MaxLength(100)
  @IsOptional()
  password?: string;

  @Transform(({ value }) => value === '' ? null : value)
  @IsEmail()
  @IsOptional()
  email?: string | null;

  @IsString()
  @MaxLength(50)
  @IsOptional()
  nickname?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class CreateAdminVersionDto {
  @IsString()
  @Matches(/^\d+\.\d+\.\d+$/, { message: '版本号格式必须为 x.y.z' })
  version: string;

  @IsString()
  @IsNotEmpty()
  updateLog: string;

  @IsString()
  @IsNotEmpty()
  downloadUrl: string;

  @IsBoolean()
  @IsOptional()
  forceUpdate?: boolean;

  @IsString()
  @IsOptional()
  platform?: string;
}

export class UpdateAdminVersionDto {
  @IsString()
  @Matches(/^\d+\.\d+\.\d+$/, { message: '版本号格式必须为 x.y.z' })
  @IsOptional()
  version?: string;

  @IsString()
  @IsOptional()
  updateLog?: string;

  @IsString()
  @IsOptional()
  downloadUrl?: string;

  @IsBoolean()
  @IsOptional()
  forceUpdate?: boolean;

  @IsString()
  @IsOptional()
  platform?: string;
}

export class CreateSystemSettingDto {
  @IsString()
  @Matches(/^[a-z][a-zA-Z0-9.\-_]*$/, { message: '配置键格式不正确' })
  key: string;

  @IsNotEmpty()
  value: unknown;

  @IsString()
  @MaxLength(50)
  @IsOptional()
  category?: string;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  description?: string;

  @IsBoolean()
  @IsOptional()
  isSecret?: boolean;
}

export class UpdateSystemSettingDto {
  @IsNotEmpty()
  @IsOptional()
  value?: unknown;

  @IsString()
  @MaxLength(50)
  @IsOptional()
  category?: string;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  description?: string;

  @IsBoolean()
  @IsOptional()
  isSecret?: boolean;
}

export class AdminIssueQueryDto extends AdminListQueryDto {
  @IsString()
  @IsOptional()
  status?: string;

  @IsString()
  @IsOptional()
  priority?: string;
}

export class CreateAdminIssueDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsIn(['bug', 'feature', 'improvement', 'maintenance'])
  @IsOptional()
  type?: string;

  @IsIn(['todo', 'planned', 'in_progress', 'fixed', 'closed'])
  @IsOptional()
  status?: string;

  @IsIn(['low', 'medium', 'high', 'urgent'])
  @IsOptional()
  priority?: string;

  @IsString()
  @Matches(/^\d+\.\d+\.\d+$/)
  @IsOptional()
  targetVersion?: string;

  @IsString()
  @MaxLength(100)
  @IsOptional()
  assignee?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  labels?: string[];
}

export class UpdateAdminIssueDto extends CreateAdminIssueDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  @IsOptional()
  title: string;
}
