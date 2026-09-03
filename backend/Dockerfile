# === 构建阶段 ===
FROM node:20-alpine AS builder
WORKDIR /app

# 限制 Node 内存（适配小内存服务器）
ENV NODE_OPTIONS="--max-old-space-size=1024"

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --no-audit --prefer-offline --legacy-peer-deps

COPY . .
RUN NODE_OPTIONS="--max-old-space-size=1024" npm run build

# === 生产阶段 ===
FROM node:20-alpine
WORKDIR /app

ENV NODE_OPTIONS="--max-old-space-size=512"

# 只安装生产运行依赖
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev --no-audit --prefer-offline --legacy-peer-deps \
    && npm cache clean --force

# 只复制生产运行所需的构建产物
COPY --from=builder /app/dist ./dist

# 创建持久化目录
RUN mkdir -p uploads/avatars public/downloads

EXPOSE 3006

# 启动服务（数据库 schema 通过 prisma db push 手动管理）
CMD ["node", "dist/main.js"]
