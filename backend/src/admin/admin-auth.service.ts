import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { timingSafeEqual } from 'crypto';
import { AdminLoginDto } from './dto/admin.dto';

@Injectable()
export class AdminAuthService {
  constructor(private readonly jwtService: JwtService) {}

  login(dto: AdminLoginDto) {
    const username = process.env.ADMIN_USERNAME;
    const password = process.env.ADMIN_PASSWORD;
    if (!username || !password) {
      throw new ServiceUnavailableException('管理端凭据尚未配置');
    }
    if (!this.safeEqual(dto.username, username) || !this.safeEqual(dto.password, password)) {
      throw new UnauthorizedException('管理员账号或密码错误');
    }

    const token = this.jwtService.sign(
      { sub: `admin:${username}`, username, scope: 'admin' },
      { expiresIn: '12h', secret: this.getJwtSecret() },
    );
    return { token, admin: { username }, expiresIn: 12 * 60 * 60 };
  }

  private safeEqual(left: string, right: string) {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private getJwtSecret() {
    return process.env.ADMIN_JWT_SECRET
      || process.env.JWT_SECRET
      || 'CHANGE-ME-set-ADMIN_JWT_SECRET-env-var';
  }
}
