import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { timingSafeEqual } from 'crypto';

@Injectable()
export class AdminAccessGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const apiKey = request.header('x-admin-key');
    const expectedApiKey = process.env.ADMIN_API_KEY;

    if (apiKey && expectedApiKey && this.safeEqual(apiKey, expectedApiKey)) {
      (request as Request & { admin?: unknown }).admin = { username: 'release-api', scope: 'admin' };
      return true;
    }

    const authorization = request.header('authorization');
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!token) throw new UnauthorizedException('请先登录管理端');

    try {
      const payload = this.jwtService.verify(token, {
        secret: this.getJwtSecret(),
      });
      if (payload?.scope !== 'admin') throw new Error('scope mismatch');
      (request as Request & { admin?: unknown }).admin = payload;
      return true;
    } catch {
      throw new UnauthorizedException('管理端会话已失效');
    }
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
