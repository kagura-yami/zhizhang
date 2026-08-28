# 知帐 zhizhang

![知帐 zhizhang 项目图标](litenote-mobile-app/public/icons/logo.png)

知帐（zhizhang）是一款面向 Android 的智能记账应用，支持手动、语音、拍照、AI 对话和支付通知自动记账，并提供统计图表、预算、财务目标和电子发票中心。

## 当前版本

- Android：`0.0.59`
- APK：[下载最新版](https://note.kagurayami.top/downloads/app-latest.apk) · [0.0.59](https://note.kagurayami.top/downloads/app-v0.0.59.apk)
- 生产 API：`https://note.kagurayami.top/`
- API 文档：`https://note.kagurayami.top/api-docs`

## 功能概览

- **多种记账方式**：手动、语音、拍照、AI 对话。
- **通知自动记账**：监听微信、支付宝等支付通知，支持去重、自动分类和来源标记。
- **统计与预算**：按日、月、年查看收入、支出和结余，提供折线图、柱状图、扇形图、预算预警和财务目标。
- **账单管理**：按月份折叠、筛选、搜索，支持编辑、删除和自定义账单时间。
- **电子发票中心**：从收票邮箱提取 PDF 发票，解析发票信息，按抬头分类并批量打包下载。
- **邮箱登录**：Outlook 支持官方 OAuth2 登录，用户点击按钮完成微软授权后自动回调；QQ、163、Gmail 和自定义邮箱支持授权码方式。
- **安全与个性化**：自动登录、生物识别、通知铃声、主题和首页内容顺序均可配置。
- **版本更新**：应用启动和打开关于页面时检查新版本并提供更新提示。

## 项目结构

```text
LiteNote/
├── litenote-backend/          # NestJS REST/SSE API
│   ├── src/
│   │   ├── auth/              # JWT 认证、登录与生物识别
│   │   ├── bills/             # 账单 CRUD、自动分类与统计
│   │   ├── categories/        # 分类管理
│   │   ├── accounts/          # 多账户管理
│   │   ├── budgets/           # 预算与预警
│   │   ├── financial-goals/   # 财务目标
│   │   ├── invoice-mailbox/   # 邮箱收票、PDF 解析与发票中心
│   │   ├── ai/                # AI 对话、工具调用与 ASR
│   │   └── app-version/       # APK 版本检查与发布
│   ├── prisma/                # PostgreSQL Schema
│   └── docker-compose.yml     # 后端 + PostgreSQL
├── litenote-mobile-app/       # React Native Android 客户端
│   ├── src/screens/           # 页面与业务流程
│   ├── src/components/        # 通用 UI 与图表组件
│   ├── src/services/          # API、通知、AI、语音和更新服务
│   └── android/               # Android 原生层与深链回调
└── docs/                      # 部署与运维文档
```

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Node.js 20 · NestJS 10 · Prisma 6 · PostgreSQL 16 · JWT · Swagger |
| 移动端 | React Native 0.81 · TypeScript · React Navigation 7 · React Query 5 |
| AI | OpenAI 兼容协议 · 多模型配置 · SSE 流式响应 · Tool Calling |
| 邮箱 | Microsoft Graph Mail.Read · ImapFlow · OAuth2/XOAUTH2 · mailparser · PDF 解析 |
| 部署 | Docker Compose · 阿里云 ECS · FRP · HTTPS |

## 本地开发

### 环境要求

- Node.js >= 18（生产镜像使用 Node.js 20）
- JDK 17、Android SDK 和 Android Studio
- Docker Desktop

### 安装依赖

```bash
git clone https://github.com/kagura-yami/zhizhang.git
cd zhizhang
npm run install:all
```

### 启动后端

```bash
copy litenote-backend/.env.example litenote-backend/.env
# 编辑 .env，至少配置 JWT_SECRET、DATABASE_URL、EMAIL_CREDENTIALS_KEY
npm run backend:start:dev
```

开发 API 默认地址为 `http://localhost:3006`，Swagger 地址为 `http://localhost:3006/api-docs`。

### 启动 Android

移动端开发环境 API 地址配置在 `litenote-mobile-app/.env.development`，生产环境配置在 `.env.production`（不要提交真实配置）。

```bash
npm run mobile:android:dev
```

构建 Release APK：

```bash
npm run mobile:build:prod
```

Windows 下如遇到 CMake 路径长度限制，请将移动端复制到较短的 NTFS 路径（例如 `C:\b\ln015`）后，在 `android` 目录执行 `gradlew.bat assembleRelease`。

## Docker + FRP 部署

详细说明见 [docs/本地-Docker-FRP-部署.md](docs/本地-Docker-FRP-部署.md)。当前部署链路为：

```text
Android App
  └── https://note.kagurayami.top
      └── 阿里云 ECS HTTPS 入口
          └── FRP :7017
              └── 本机 remote-frpc
                  └── Docker LiteNote API :3006
                      └── Docker PostgreSQL
```

后端目录中的常用脚本：

```powershell
cd D:\Dev\Consultation\LiteNote\litenote-backend
.\start.ps1   # 构建并启动
.\logs.ps1    # 跟随日志
.\stop.ps1    # 停止容器，保留数据库卷
```

不要使用 `docker compose down -v`，除非明确要删除数据库卷。

## Outlook OAuth2 配置

Outlook 登录按钮需要管理员预先注册 Microsoft Entra 应用。普通用户不需要填写邮箱密码或授权码。

在 Entra 应用中配置：

- Web 重定向 URI：`https://note.kagurayami.top/invoice-mailbox/oauth/outlook/callback`
- Microsoft Graph Delegated 权限：`Mail.Read`、`offline_access`、`openid`、`profile`、`email`

将真实值只写入服务器 `litenote-backend/.env`，不要写入 Git：

```env
OUTLOOK_OAUTH_CLIENT_ID=你的应用客户端ID
OUTLOOK_OAUTH_CLIENT_SECRET=你的应用客户端密钥
OUTLOOK_OAUTH_REDIRECT_URI=https://note.kagurayami.top/invoice-mailbox/oauth/outlook/callback
```

修改后重启后端：

```powershell
docker compose up -d --build app
```

Outlook 通过 Microsoft Graph 官方授权读取收件箱，不需要手动开启 IMAP，也不需要填写邮箱密码或授权码。QQ、163、Gmail 和自定义邮箱仍使用服务商生成的授权码，不能使用邮箱登录密码。

## 版本发布

每次功能修改（包括小改动）都递增移动端版本号，同时更新 Android `versionCode`/`versionName`、构建 APK、上传后端版本记录并验证检查更新接口：

```text
POST http://127.0.0.1:3006/app-version/upload
GET  http://127.0.0.1:3006/app-version/latest?platform=android
GET  http://127.0.0.1:3006/app-version/check?currentVersion=0.0.38&platform=android
```

发布文件位于 `litenote-backend/public/downloads/`，稳定地址为 `/downloads/app-latest.apk`。

## 安全约定

- `.env`、OAuth Client Secret、JWT Secret、数据库密码、签名文件和 `keystore.properties` 禁止提交。
- 收票邮箱授权信息和 Outlook Refresh Token 仅在服务端加密保存。
- Release APK 使用 HTTPS 生产 API，不允许明文 HTTP。
- Android 签名文件必须在项目目录之外加密备份；丢失后无法覆盖升级已安装应用。

## 许可证

MIT
