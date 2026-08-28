# 知帐项目协作说明

## 项目边界

- `backend/`：NestJS 10 + Prisma 6 后端，默认监听本机 `3006`。
- `mobile/`：React Native 0.81 Android 客户端，应用名“知帐”，包名 `com.zhizhang`，JS 注册名 `zhizhang`。
- `docs/`：部署、架构和交接文档；`backend/public/downloads/` 与 `backend/uploads/` 是运行数据，不属于 Git 源码。

## 常用入口

```powershell
cd D:\Dev\Projects\Zhizhang
npm run install:all
npm run backend:start:dev
npm run mobile:android:dev
```

后端 Docker：

```powershell
cd D:\Dev\Projects\Zhizhang\backend
.\start.ps1
.\logs.ps1
.\stop.ps1
```

不要使用 `docker compose down -v`，数据库卷 `litenote-postgres-data` 保存现有业务数据。

## 构建和发布红线

- 每次移动端改动都递增版本号与 Android `versionCode`，构建 Release APK，并同步 `/app-version` 版本记录。
- 生产 API 是 `https://note.kagurayami.top/`；Release 构建必须使用 `mobile/.env.production`，该文件禁止提交。
- Windows Android Release 使用 `C:\b\ln015` 等短路径构建目录，避免 NitroModules/CMake 路径过长；构建前需同步 `src/main` 和 `src/test`。
- 当前版本 `0.0.64` / `versionCode 84`，APK 包名 `com.zhizhang`。
- 不提交 `.env`、OAuth 密钥、JWT 密钥、数据库密码、签名文件、授权令牌或运行时上传文件。

## 迁移后的目录约定

旧的目录名已统一为 `backend/` 与 `mobile/`。运行时仍保留旧数据库卷名以复用已有数据；不要为了改名删除或重建该卷。
