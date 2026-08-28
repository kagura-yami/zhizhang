import { IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BiometricLoginDto {
  @ApiProperty({ description: '设备生物识别解锁后释放的随机设备凭据' })
  @IsString()
  @IsNotEmpty()
  @MinLength(32)
  @MaxLength(256)
  credential: string;
}

export class EnrollBiometricDto extends BiometricLoginDto {
  @ApiPropertyOptional({ description: '设备名称，仅用于账号安全页展示' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  deviceLabel?: string;
}
