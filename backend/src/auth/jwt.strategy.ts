import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';

interface JwtPayload {
  sub: string; // 用户ID
  username: string;
  iat?: number;
  exp?: number;
  purpose?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'CHANGE-ME-set-JWT_SECRET-env-var',
    });
  }

  /**
   * 验证JWT payload并返回用户信息
   * 返回的对象会被附加到request.user
   */
  async validate(payload: JwtPayload) {
    if (payload.purpose || typeof payload.sub !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.sub)) {
      throw new UnauthorizedException('无效的登录凭证');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        username: true,
        email: true,
        nickname: true,
        avatar: true,
        isActive: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('账户已被禁用');
    }

    return user;
  }
}
