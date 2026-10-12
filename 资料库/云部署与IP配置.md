# 云部署与 IP/域名配置

## 个人项目免费/便宜方案（2026）

| 平台 | 免费额度 | 适合 |
|---|---|---|
| Vercel | 100GB 流量/月，100万函数调用 | Next.js、React 前端 |
| Netlify | 100GB 流量 | 静态站 |
| Cloudflare Pages | 无限流量 | 静态站、边缘函数 |
| Railway | $5 试用额度，Free 计划 $1/月 | 前后端+数据库 |
| Render | 750 小时/月，数据库 1GB | 全栈小项目 |
| 阿里云/腾讯云学生机 | 学生认证后一年几十块 | 国内项目、备案 |

## 域名与 HTTPS

1. 域名在阿里云/腾讯云/Cloudflare 买（.com 约 ¥60/年，.cn 便宜）
2. **国内服务器必须备案**（约 2-3 周），不用备案就用境外节点（Vercel/Cloudflare）
3. HTTPS 证书：
   - Vercel/Netlify/Railway 自动签发，零配置
   - 自建服务器用 Certbot 免费申请 Let's Encrypt 证书，自动续期
4. DNS 解析：A 记录指向服务器 IP，CNAME 指向平台域名

## 服务器安全组（防火墙）

只开必要端口：
- 80（HTTP）、443（HTTPS）开放给所有人
- 22（SSH）只开放给自己的 IP
- 数据库端口（3306/6379）**绝不**对公网开放

## Nginx 常用配置思路

- 反向代理：前端静态文件 + 后端 API 转发
- gzip 压缩
- HTTPS 终止
- 限流（防刷）

## Docker 常用命令

```bash
docker build -t myapp .          # 构建镜像
docker run -p 3000:3000 myapp    # 运行并映射端口
docker ps                        # 看运行中的容器
docker logs myapp                # 看日志
docker compose up -d             # 一键启动多容器（app+db）
docker compose down              # 停止
```

## 部署流程（CI/CD）

1. 代码推到 GitHub
2. GitHub Actions 自动跑测试
3. 测试过 → 自动构建 Docker 镜像
4. 推到服务器 → 重启容器
5. 全程不用登录服务器

## 监控

- 小项目：看平台自带日志
- 进阶：Sentry 抓前端错误、UptimeRobot 免费监控宕机
