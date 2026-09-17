import { IsString, MaxLength, IsUUID } from 'class-validator';
export class DeviceChallengeDto { @IsUUID() sessionId: string; }
export class DeviceRenewDto {
  @IsString() @MaxLength(2048) challenge: string;
  @IsString() @MaxLength(256) signature: string;
}
