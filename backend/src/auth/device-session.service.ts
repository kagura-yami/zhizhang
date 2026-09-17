import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, createPublicKey, randomUUID, verify } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
@Injectable()
export class DeviceSessionService {
  constructor(private readonly prisma: PrismaService, private readonly jwt: JwtService) {}
  private idleExpiry() { return new Date(Date.now() + 180 * 86400000); }
  async issue(userId: string, username: string, publicKey: string) {
    try {
      const key = createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' });
      if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw new Error();
    } catch { throw new BadRequestException('设备密钥格式无效'); }
    const session = await this.prisma.deviceSession.create({ data: { userId, publicKey, expiresAt: this.idleExpiry() } });
    return this.token(session.id, userId, username);
  }
  private token(sid: string, sub: string, username: string) {
    return this.jwt.sign({ sub, username, sid }, { expiresIn: '30m' });
  }
  private async session(sid: string) {
    if (typeof sid !== 'string' || !/^[0-9a-f-]{36}$/i.test(sid)) throw new UnauthorizedException('登录状态已失效，请重新登录');
    const session = await this.prisma.deviceSession.findUnique({ where: { id: sid }, include: { user: true } });
    if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now() || !session.user.isActive) {
      throw new UnauthorizedException('登录状态已失效，请重新登录');
    }
    return session;
  }
  private signature(publicKey: string, message: string, signature: string) {
    try {
      if (typeof signature !== 'string' || signature.length > 256 || !verify('sha256', Buffer.from(message),
        { key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' }, Buffer.from(signature, 'base64'))) throw new Error();
    } catch { throw new UnauthorizedException('设备验证失败，请重新登录'); }
  }
  private async consume(value: string) {
    try {
      await this.prisma.deviceProofNonce.create({ data: { id: digest(value), expiresAt: new Date(Date.now() + 300000) } });
    } catch (error) {
      if (error?.code === 'P2002') throw new UnauthorizedException('设备凭证已使用');
      throw error;
    }
    // Indexed cleanup; expiry remains longer than the accepted proof/challenge window.
    await this.prisma.deviceProofNonce.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  }
  async challenge(sid: string) {
    await this.session(sid);
    return this.jwt.sign({ sid, purpose: 'device-renew', nonce: randomUUID() }, { expiresIn: '2m' });
  }
  async renew(challenge: string, signature: string) {
    let payload: any;
    try { payload = this.jwt.verify(challenge); } catch { throw new UnauthorizedException('续期验证已失效'); }
    if (payload.purpose !== 'device-renew') throw new UnauthorizedException();
    const session = await this.session(payload.sid);
    this.signature(session.publicKey, challenge, signature);
    await this.consume('renew:' + payload.nonce);
    const updated = await this.prisma.deviceSession.updateMany({ where: { id: session.id, revokedAt: null, expiresAt: { gt: new Date() } }, data: { expiresAt: this.idleExpiry() } });
    if (!updated.count) throw new UnauthorizedException();
    return this.token(session.id, session.userId, session.user.username);
  }
  async verifyRequest(sid: string, userId: string, req: any) {
    const session = await this.session(sid);
    if (session.userId !== userId) throw new UnauthorizedException();
    const time = req.headers['x-device-time'], nonce = req.headers['x-device-nonce'];
    if (typeof time !== 'string' || !/^\d{13}$/.test(time) || Math.abs(Date.now() - Number(time)) > 120000 ||
        typeof nonce !== 'string' || !/^[0-9a-f-]{36}$/i.test(nonce)) throw new UnauthorizedException('设备验证失败，请重新登录');
    const token = String(req.headers.authorization || '').replace(/^Bearer /i, '');
    const target = req.originalUrl;
    this.signature(session.publicKey, ['v1', req.method.toUpperCase(), target, digest(token), time, nonce].join('\n'), req.headers['x-device-signature']);
    await this.consume(sid + ':' + nonce);
  }
  async revoke(sid: string, userId: string) {
    await this.prisma.deviceSession.updateMany({ where: { id: sid, userId }, data: { revokedAt: new Date() } });
  }
}
