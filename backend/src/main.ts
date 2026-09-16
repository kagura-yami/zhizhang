import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import * as express from 'express';
import { Request, Response } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // 企业微信回调通过现有公网 API 域名转发到本机 Bot。
  // 该中间件必须在 JSON body parser 之前注册，以保留原始 XML 请求体。
  const botTarget = (process.env.BOT_CALLBACK_TARGET || 'http://host.docker.internal:3007').replace(/\/$/, '');
  app.use('/wechat/callback', express.raw({ type: '*/*', limit: '2mb' }), async (req: Request, res: Response) => {
    try {
      const target = `${botTarget}${req.originalUrl}`;
      console.log(`[wechat-proxy] ${req.method} ${req.originalUrl}`);
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (key.toLowerCase() === 'host' || key.toLowerCase() === 'content-length') continue;
        if (typeof value === 'string') headers.set(key, value);
        else if (Array.isArray(value)) headers.set(key, value.join(', '));
      }
      const response = await fetch(target, {
        method: req.method,
        headers,
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : new Uint8Array(req.body as Buffer),
      });
      console.log(`[wechat-proxy] upstream ${response.status}`);
      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));
      const payload = Buffer.from(await response.arrayBuffer());
      return res.end(payload);
    } catch (error) {
      console.error('[wechat-proxy] callback forward failed', error);
      return res.status(502).send('wechat callback unavailable');
    }
  });

  // AstrBot 企业微信智能机器人统一 Webhook 代理。
  // 外部使用 /astrbot/<uuid>，内部转发到 AstrBot 的 /api/platform/webhook/<uuid>。
  // 单独路径不会影响现有自建应用 /wechat/callback。
  const astrbotTarget = (process.env.ASTRBOT_CALLBACK_TARGET || 'http://host.docker.internal:6185').replace(/\/$/, '');
  app.use('/astrbot', express.raw({ type: '*/*', limit: '2mb' }), async (req: Request, res: Response) => {
    try {
      const suffix = req.originalUrl.slice('/astrbot'.length) || '/';
      const target = `${astrbotTarget}/api/platform/webhook${suffix}`;
      console.log(`[astrbot-proxy] ${req.method} ${req.originalUrl}`);
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (key.toLowerCase() === 'host' || key.toLowerCase() === 'content-length') continue;
        if (typeof value === 'string') headers.set(key, value);
        else if (Array.isArray(value)) headers.set(key, value.join(', '));
      }
      const response = await fetch(target, {
        method: req.method,
        headers,
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : new Uint8Array(req.body as Buffer),
      });
      console.log(`[astrbot-proxy] upstream ${response.status}`);
      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));
      return res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      console.error('[astrbot-proxy] callback forward failed', error);
      return res.status(502).send('astrbot callback unavailable');
    }
  });

  // 提升请求体大小限制（图片 base64 编码较大）
  app.useBodyParser('json', { limit: '10mb' });

  // 配置静态文件服务（用于头像等上传文件）
  app.useStaticAssets(join(__dirname, '..', 'uploads'), {
    prefix: '/uploads/',
  });

  // 宣传网站部署在现有 FRP → 后端链路上。对外使用无扩展名的
  // /experience、/download、/changelog、/contact；旧 .html 地址仅做
  // 永久重定向，/app-version、/downloads、/api-docs 和业务 API 不受影响。
  const siteRoot = join(process.cwd(), 'public', 'site');
  const expressApp = app.getHttpAdapter().getInstance();
  const cleanSiteRoutes: Record<string, string> = {
    '/experience': 'experience.html',
    '/download': 'download.html',
    '/changelog': 'changelog.html',
    '/contact': 'contact.html',
  };

  expressApp.get('/index.html', (_req: Request, res: Response) => res.redirect(308, '/'));
  expressApp.get('/site/index.html', (_req: Request, res: Response) => res.redirect(308, '/'));
  expressApp.get(/^\/(experience|download|changelog|contact)\/$/, (req: Request, res: Response) => {
    return res.redirect(308, req.path.slice(0, -1));
  });
  for (const [cleanPath, fileName] of Object.entries(cleanSiteRoutes)) {
    expressApp.get(cleanPath, (_req: Request, res: Response) => res.sendFile(join(siteRoot, fileName)));
    expressApp.get(`/${fileName}`, (_req: Request, res: Response) => res.redirect(308, cleanPath));
    expressApp.get(`/site/${fileName}`, (_req: Request, res: Response) => res.redirect(308, cleanPath));
  }

  app.use(express.static(siteRoot, {
    index: 'index.html',
    redirect: false,
  }));

  // 管理端使用独立静态目录与 /admin-api，不写入宣传页导航或站点入口。
  const adminRoot = join(process.cwd(), 'admin-ui');
  expressApp.get('/admin', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    return res.sendFile(join(adminRoot, 'index.html'));
  });
  expressApp.get('/admin/', (_req: Request, res: Response) => res.redirect(308, '/admin'));
  expressApp.use('/admin-assets', express.static(adminRoot, {
    index: false,
    redirect: false,
    maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
  }));

  // Enable CORS for React Native
  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  // Enable validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  // Swagger API文档配置
  const config = new DocumentBuilder()
    .setTitle('智能记账 API')
    .setDescription('智能记账后端 API 文档，包含记账、分类管理、预算追踪、AI 助手等功能')
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: '请输入JWT token',
      },
      'JWT-auth',
    )
    .addTag('auth', '用户认证')
    .addTag('bills', '账单管理')
    .addTag('categories', '分类管理')
    .addTag('app-version', '应用版本管理')
    .addTag('admin', '后台管理')
    .addServer(`http://localhost:${process.env.PORT ?? 3000}`, '开发环境')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api-docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      docExpansion: 'none',
      filter: true,
      showRequestHeaders: true,
    },
    customSiteTitle: '智能记账 API 文档',
  });

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  console.log(`🚀 Backend server is running on http://localhost:${port}`);
  console.log(
    `📚 Swagger API docs available at http://localhost:${port}/api-docs`,
  );
  console.log('🔍 API endpoints:');
  console.log(`   - Bills: http://localhost:${port}/api-docs#/bills`);
  console.log(`   - Categories: http://localhost:${port}/api-docs#/categories`);
}
bootstrap();
