# 9POP 同事测试数据（2026-10-21）

本目录按用户本次明确授权，将本地新增业务数据随代码提交到私有仓库 `test` 分支。仅供获准同事本地测试，不公开分发。包含真实授权业务数据，未将业务身份或金额替换为合成值；不包含云端连接凭据、模型配置、原登录密码或会话。此授权仅适用于本次测试快照，不改变常规客户数据不入库规则。

## 内容与边界

- PostgreSQL、Wiki SQLite 和本地对象文件；原岗位、空间、数据访问权限保留。
- 包含 107 表全量接入后的快照、历史归属投影、治理结果和员工消费映射；338 条活动表路由。
- 整库包含 412 个业务数据集、1098 个数据快照、685 条全部类型的来源映射；不是 412 张源业务表。来源采集批次不同，不能把导出时间当成统一业务截止时间。
- 原 107 表采集量 68673 行；273 个消费投影含 30930 行（有跨用途和参考表复制，不能视为新增业务记录数）。
- 自动采集、画报定时生成及待执行任务关闭或暂停；不携带云端采集注册表。仅供冻结数据测试，不自动连接生产库；真实模型模式为 `off`。

## 恢复与启动

在仓库根目录安装依赖并按 README 准备 Node、Java 和 PostgreSQL 18。使用新目录，恢复命令拒绝覆盖已有实例：

```bash
npm ci
npm --prefix engine ci
npm --prefix integrations/mengine-wiki ci
npm run trial:build
npm --prefix integrations/mengine-wiki run build
python3 scripts/ninepop/dev_bundle.py restore \
  --bundle test-data/ninepop-20261021/ninepop-dev.tar.gz \
  --directory .local/ninepop-test-20261021 \
  --sha256 39e6fc8226bbd122e0f034d017127c37726a7a9dfb949e29c5be2a4c59e478e2
python3 scripts/local/trial.py start --directory .local/ninepop-test-20261021 --phone-local
```

启动地址由命令输出；恢复会为每位员工和总台管理员生成全新随机密码，保存在新目录的 `accounts.json`，仅在本机查看，不提交或发送到群聊。登录后可核对资料、治理知识、现有画报与各岗位的数据可见性。没有真实模型时，不将模拟执行视为真实生成验收。

`manifest.json` 列出归档内文件 SHA-256 和整库数量；`SHA256SUMS` 校验压缩包。原开发实例不被恢复操作修改。完整业务范围见 [消费链路验证](../../docs/交接/员工画报数据消费链路-实施与验证-2026-10-21.md)。
