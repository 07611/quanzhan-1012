# Web 安全清单（全栈项目必看）

## 认证方案对比

| 方案 | 原理 | 适用 |
|---|---|---|
| Session+Cookie | 服务端存会话 ID，Cookie 发给浏览器 | 传统网站、同域 |
| JWT | 无状态令牌，自带签名，请求头携带 | 前后端分离、跨域、API |
| Auth.js/NextAuth | 封装好的登录方案，支持各种 Provider | Next.js 项目省得自己写 |
| OAuth2 第三方 | 微信/GitHub/Google 授权 | 不想自己管密码 |

## JWT 常见坑

- Access Token 短命（15分钟-2小时），配合 Refresh Token
- 不要把敏感信息放 payload，它只是 Base64 编码，不是加密
- 登出要做服务端黑名单或短期过期
- HTTPS 是前提，否则 token 会被中间人截

## 必防攻击

| 攻击 | 原理 | 怎么防 |
|---|---|---|
| SQL 注入 | 用户输入拼进 SQL | 参数化查询 / ORM |
| XSS | 页面注入恶意脚本 | 输出转义、CSP、HttpOnly Cookie |
| CSRF | 借登录态发伪造请求 | CSRF Token、SameSite Cookie |
| 越权 | 访问别人的数据 | 每个接口都校验资源归属 |
| 暴力破解 | 撞库 | 速率限制、验证码、锁定 |
| 文件上传 | 传恶意文件 | 白名单后缀、存到独立域名、扫毒 |

## 安全响应头（Helmet 默认就带）

- `Strict-Transport-Security`：强制 HTTPS
- `Content-Security-Policy`：限制资源加载来源
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`：防 iframe 嵌套点击劫持
- 不泄露 `Server` 头版本号

## 依赖安全

- 定期 `npm audit` / `pip audit`
- 不要用没维护的库
- secret（数据库密码、API key）放环境变量，绝不提交 Git
