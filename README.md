# 澄研智库

面向美妆电商团队的本地知识与协同工作台，当前包含可信商品数据清洗、目标与飞书周报协同、事项拆解和分析记录等能力。

## 快速启动

要求：Node.js 20+。

```powershell
npm ci
npm run dev
```

- 开发页面：`http://127.0.0.1:5174`
- API 健康检查：`http://127.0.0.1:5175/api/health`

生产模式：

```powershell
npm ci
npm run build
npm start
```

访问 `http://127.0.0.1:5175`。局域网共享与飞书配置见 [部署说明](docs/部署说明.md)。

## 测试数据与账号

- 测试种子库：`data/seed/chengyan-test.db`
- 首次启动且不存在 `data/chengyan.db` 时，会自动复制种子库。
- 管理员：`admin` / `AdminTest#2026`
- 成员：`member` / `MemberTest#2026`
- 管理员可以进入“用户管理”新增、启停用户；成员可使用业务模块。
- 飞书同步使用测试者自己的飞书用户授权，不提供共享密码或令牌。

完整交付信息见 [团队测试交付清单](docs/团队测试交付清单.md)。
