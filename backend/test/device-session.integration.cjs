const assert = require('node:assert/strict');
const { generateKeyPairSync, sign, createHash, randomUUID } = require('node:crypto');
const url = new URL(process.env.DATABASE_URL || 'http://missing');
if (url.hostname !== '127.0.0.1' || url.pathname !== '/zhizhang_auth_test') throw Error('Isolated auth test database required');
process.env.JWT_SECRET = 'isolated-device-session-test-secret';
const { Module, ValidationPipe } = require('@nestjs/common');
const { NestFactory, APP_GUARD } = require('@nestjs/core');
const { AuthModule } = require('../dist/auth/auth.module');
const { PrismaService } = require('../dist/prisma/prisma.service');
const { JwtAuthGuard } = require('../dist/auth/jwt-auth.guard');
class Root {}
Module({ imports: [AuthModule], providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }] })(Root);
(async () => {
 const app = await NestFactory.create(Root, {logger:['error']});
 app.useGlobalPipes(new ValidationPipe({whitelist:true,transform:true}));
 await app.listen(0,'127.0.0.1');const base=await app.getUrl(),db=app.get(PrismaService);
 const a=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),b=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
 const pub=k=>k.publicKey.export({format:'der',type:'spki'}).toString('base64');
 const sig=(k,message)=>sign('sha256',Buffer.from(message),k.privateKey).toString('base64');
 const claims=t=>JSON.parse(Buffer.from(t.split('.')[1],'base64url'));
 const proof=(t,k,path,method='GET')=>{
  const time=String(Date.now()),nonce=randomUUID();return {'X-Device-Time':time,'X-Device-Nonce':nonce,'X-Device-Signature':sig(k,['v1',method,path,createHash('sha256').update(t).digest('hex'),time,nonce].join('\n'))};
 };
 const call=async(path,method='GET',body,token,headers={})=>{const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};};
 const username='auth-'+randomUUID(),password='test-password-163';let id;
 try {
  let r=await call('/auth/register','POST',{username,password,devicePublicKey:pub(a)});assert.equal(r.status,201);let token=r.data.data.token;id=r.data.data.user.id;
  assert(claims(token).sid);assert.equal(claims(token).exp-claims(token).iat,1800);
  assert.equal((await call('/auth/profile','GET',null,token)).status,401,'copied bearer must fail');
  assert.equal((await call('/auth/profile','GET',null,token,proof(token,b,'/auth/profile'))).status,401,'different device must fail');
  const headers=proof(token,a,'/auth/profile');assert.equal((await call('/auth/profile','GET',null,token,headers)).status,200);
  assert.equal((await call('/auth/profile','GET',null,token,headers)).status,401,'replay must fail');
  assert.equal((await call('/auth/profile','GET',null,token,proof(token,a,'/different'))).status,401,'path binding');
  const concurrent=proof(token,a,'/auth/profile');const rs=await Promise.all([call('/auth/profile','GET',null,token,concurrent),call('/auth/profile','GET',null,token,concurrent)]);assert.deepEqual(rs.map(x=>x.status).sort(),[200,401]);
  const challenge=(await call('/auth/device/challenge','POST',{sessionId:claims(token).sid})).data.data.challenge;
  assert.equal((await call('/auth/device/renew','POST',{challenge,signature:sig(b,challenge)})).status,401);
  r=await call('/auth/device/renew','POST',{challenge,signature:sig(a,challenge)});assert.equal(r.status,200);token=r.data.data.token;
  assert.equal((await call('/auth/device/renew','POST',{challenge,signature:sig(a,challenge)})).status,401);
  const credential='a'.repeat(96);
  assert.equal((await call('/auth/biometric/enroll','POST',{credential,devicePublicKey:pub(a)},token,proof(token,a,'/auth/biometric/enroll','POST'))).status,201);
  assert.equal((await call('/auth/biometric/login','POST',{credential,devicePublicKey:pub(b)})).status,401);
  assert.equal((await call('/auth/biometric/login','POST',{credential,devicePublicKey:pub(a)})).status,200);
  assert.equal((await call('/auth/device/logout','POST',{},token,proof(token,a,'/auth/device/logout','POST'))).status,200);
  assert.equal((await call('/auth/profile','GET',null,token,proof(token,a,'/auth/profile'))).status,401);
  assert.equal((await call('/auth/device/challenge','POST',{sessionId:claims(token).sid})).status,401);
  r=await call('/auth/login','POST',{username,password,devicePublicKey:pub(a)});assert.equal(r.status,200);token=r.data.data.token;
  await db.deviceSession.update({where:{id:claims(token).sid},data:{expiresAt:new Date(0)}});
  assert.equal((await call('/auth/device/challenge','POST',{sessionId:claims(token).sid})).status,401,'idle expiry');
  r=await call('/auth/login','POST',{username,password,devicePublicKey:pub(a)});token=r.data.data.token;
  assert.equal((await call('/auth/password','PATCH',{currentPassword:password,newPassword:'changed-password-163'},token,proof(token,a,'/auth/password','PATCH'))).status,200);
  assert.equal((await call('/auth/profile','GET',null,token,proof(token,a,'/auth/profile'))).status,401,'password change revokes');
  assert.equal(await db.biometricCredential.count({where:{userId:id}}),0);
  r=await call('/auth/login','POST',{username,password:'changed-password-163'});assert.equal(r.status,200);assert.equal((await call('/auth/profile','GET',null,r.data.data.token)).status,200,'legacy compatibility');
  console.log('PASS device sessions: binding, replay, concurrent replay, renew, revoke, idle expiry, password change, biometric binding, legacy compatibility');
 } finally { if(id)await db.user.delete({where:{id}});await app.close(); }
})().catch(e=>{console.error(e);process.exit(1)});
