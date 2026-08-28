# Project Context Analysis

## Analysis Purpose

梳理知帐的代码边界、运行依赖、持久化数据与访问链路，并记录本机 Docker + 阿里云 ECS FRP 的实际部署方式。

## Codebase Structure

```text
Zhizhang/
├── backend/                   NestJS REST API
│   ├── src/                   认证、账单、分类、账户、预算、AI、更新服务
│   ├── prisma/                PostgreSQL 数据模型
│   ├── Dockerfile             后端多阶段镜像构建
│   ├── docker-compose.yml     后端与 PostgreSQL 编排入口
│   ├── start.ps1              构建并启动
│   ├── stop.ps1               停止容器，保留数据
│   └── logs.ps1               跟随后端日志
├── mobile/                    React Native Android 客户端
│   ├── src/screens/           页面
│   ├── src/components/        UI、业务与图表组件
│   ├── src/services/          HTTP、AI、语音、通知与更新服务
│   └── .env.production        生产 API 地址，本地文件且不提交 Git
└── docs/                      项目文档与截图
```

## Dependencies

- 后端：Node.js 20、NestJS 10、Prisma 6、JWT、Swagger。
- 数据库：PostgreSQL 16 Alpine，使用 Docker 命名卷持久化。
- 移动端：React Native 0.81、React Query 5、React Navigation 7。
- 公网入口：本机 `remote-frpc` 连接阿里云 ECS 上的 `frps`。

## Connections

移动端通过 HTTPS 请求 NestJS API；NestJS 使用 Prisma 访问 PostgreSQL。头像、APK 与热更新文件由后端静态目录提供。公网请求先由 ECS 上的 HTTPS 入口完成证书处理，再转发到 FRP 的 `7017` 端口，最后进入本机 `3006`。

## Architecture Patterns

项目采用 Monorepo。后端是模块化 NestJS 单体服务，Controller 负责 REST/SSE 接口，Service 承载业务逻辑，Prisma 负责数据访问；移动端按页面、组件、Hook 与 Service 分层。

## Codebase Conventions

- 后端功能按领域模块放在 `backend/src/<domain>/`。
- DTO 与 Controller、Service 同模块组织。
- 移动端统一从 `src/services/` 调用 API，通过环境文件切换地址。
- 运行密钥只保存在被 Git 忽略的 `.env` 中。

## Dependency Graph

```text
React Native App
  └── HTTP / SSE
      └── NestJS API :3006
          ├── Prisma ── PostgreSQL :5432（仅 Docker 内网）
          ├── uploads/（头像）
          └── public/downloads/（APK 与热更新）

公网客户端
  └── https://note.kagurayami.top
      └── ECS HTTPS 入口（TLS 证书）
          └── ECS frps :7017
              └── 本机 remote-frpc
                  └── host.docker.internal:3006
```

## Component Relationships

用户操作从移动端页面进入 API Service，经 JWT 请求后端领域 Controller；Controller 调用 Service，Service 通过 Prisma 读写数据库。AI 对话还会按用户配置调用 Claude、OpenAI、DeepSeek 或 Qwen 兼容接口。

## Key Insights

- Docker 部署的是后端与数据库；React Native 客户端需要单独构建 APK。
- 当前项目没有独立 Web 主页；根地址是 API 服务，接口文档位于 `/api-docs`，主要客户端是 Android App。
- PostgreSQL 不发布宿主机端口，避免与本机已有数据库冲突并减少公网暴露面。
- 当前 `D:` 盘不支持 PostgreSQL 初始化所需的权限修改，因此数据库必须使用 Docker 命名卷，不能直接绑定到项目目录。
- README 写明默认端口为 `3006`，源码无环境变量时实际回退到 `3000`；Compose 已通过 `.env` 显式固定为 `3006`。
- Windows 下 React Native NitroModules/CMake 会受到路径长度限制，release 构建必须使用类似 `C:\b\l30\m` 的超短 NTFS 临时路径，不能直接在当前长路径或 `%TEMP%` 的长目录名下构建。

## 部署与运维

- 本地 API：`http://127.0.0.1:3006/`
- 本地 Swagger：`http://127.0.0.1:3006/api-docs`
- 公网 API：`https://note.kagurayami.top/`
- 公网 Swagger：`https://note.kagurayami.top/api-docs`
- Android APK：`https://note.kagurayami.top/downloads/app-v0.0.64.apk`
- 稳定下载地址：`https://note.kagurayami.top/downloads/app-latest.apk`
- Android 版本：`0.0.64`（通用四 ABI release 包）
- APK SHA256：`C9CBB7717ECEEA150D1CE7F591E3C24B4AEAA0304A9A872D6BC785C307BCFC12`
- 数据库卷：`zhizhang-postgres-data`（旧卷 `litenote-postgres-data` 仅用于回滚）
- 头像目录：`backend/uploads/`
- APK 与热更新目录：`backend/public/downloads/`
- FRP 配置：`D:\Dev\frpEnv\frpc.toml` 与 `D:\Dev\frpEnv\.env`

```powershell
cd D:\Dev\Projects\Zhizhang\backend
.\start.ps1
.\logs.ps1
.\stop.ps1
```

`stop.ps1` 只停止并移除容器与网络，不删除数据库命名卷或业务文件。不要使用 `docker compose down -v`，除非明确要删除数据库。

## Android release 构建与签名

- 生产 API 配置保存在被 Git 忽略的 `mobile/.env.production`，当前地址为 `https://note.kagurayami.top/`。
- release 包禁止明文 HTTP，合并后的 Manifest 中 `usesCleartextTraffic=false`。
- release 签名文件为 `mobile/android/app/zhizhang-release.keystore`，密码配置为 `mobile/android/keystore.properties`；两者均被 Git 忽略。
- 必须将签名文件和密码配置加密备份到项目目录之外。当前包名为 `com.zhizhang`，签名丢失后无法覆盖升级已安装的知帐。
- 发布接口为本地 `POST http://127.0.0.1:3006/app-version/upload`；上传成功后，版本信息可从 `https://note.kagurayami.top/app-version/latest?platform=android` 查询。
- Outlook OAuth2 变量只配置在服务器 `.env`：`OUTLOOK_OAUTH_CLIENT_ID`、`OUTLOOK_OAUTH_CLIENT_SECRET`、`OUTLOOK_OAUTH_REDIRECT_URI`；真实值不得写入 Git。回调地址为 `https://note.kagurayami.top/invoice-mailbox/oauth/outlook/callback`。个人 Microsoft 账号使用 Microsoft Graph `Mail.Read` 委托权限读取发票邮件。
