# 数据库与 ORM 知识

## 四种主库怎么选

| 数据库 | 类型 | 什么时候用 |
|---|---|---|
| MySQL | 关系型 | 教学、课程作业、国内企业 Web 项目，最稳的默认 |
| PostgreSQL | 关系型 | 复杂查询、JSON、地理信息、全文检索，功能比 MySQL 强 |
| MongoDB | 文档型 | 数据结构经常变、快速原型、内容管理 |
| SQLite | 嵌入式 | 本地原型、桌面应用、小工具，一个文件就是库 |
| Redis | 内存键值 | 缓存、会话、排行榜、分布式锁（不是主库） |
| InfluxDB | 时序 | 监控数据、物联网 |
| Elasticsearch | 搜索引擎 | 全文检索、日志分析 |

## ORM 对比

| ORM | 语言 | 特点 |
|---|---|---|
| Prisma | TS/Node | 现在最流行，类型安全，migrations 漂亮 |
| Drizzle | TS/Node | 轻量，贴近 SQL，包小 |
| TypeORM | TS/Node | 老牌，装饰器风格 |
| SQLAlchemy | Python | Python ORM 老大哥，功能全 |
| Tortoise ORM | Python | 异步 ORM，跟 FastAPI 配 |
| Django ORM | Python | Django 自带，简单 |
| MyBatis | Java | SQL 自己写，灵活可控 |
| JPA/Hibernate | Java | 全自动，企业标准 |
| GORM | Go | Go 最流行 ORM |
| Diesel | Rust | Rust 类型安全 ORM |

## 连接池

- 生产环境必用连接池，不要每次请求新建连接
- Node：`pg`、`mysql2` 自带连接池
- Python：SQLAlchemy 自带
- Java：HikariCP 默认
- Go：sql.DB 本身就是池

## 常见坑

1. 不要在循环里查数据库（N+1 问题），用 JOIN 或批量 IN
2. 索引加在 WHERE/JOIN/ORDER BY 的列上，别瞎加
3. 密码用 bcrypt/argon2 哈希，绝不能明文或 MD5
4. 迁移文件要进 Git，不要手工改生产库
