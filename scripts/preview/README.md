# 预览环境第四端人工建号

`--bootstrap-agent-admin` 仅用于预览合成账号，由维护者显式执行；普通 Web 启动不会建号。生产需正式发号流程，不能使用这个预览入口。

使用包含本改动的已构建 API JAR，先通过当前预览实例的私有配置设置 `DATABASE_URL`、`DATABASE_USER`、`DATABASE_PASSWORD`，核实目标确为预览数据库。口令须预先写入当前维护者的私有普通文件：权限恰为 `0600`、非软链、文件不超过 512 字节，口令长度遵循现有策略（6–128 字符，去掉文件末尾空白）。私有目录建议 `0700`；不要把口令写在命令行、版本库或日志里。

```sh
# 文件需事先安全准备；此处只传路径，不包含口令。
export AGENT_BOOTSTRAP_PASSWORD_FILE="$PWD/.local/preview-private/agent-admin-password"
chmod 600 "$AGENT_BOOTSTRAP_PASSWORD_FILE"
export AGENT_BOOTSTRAP_LOGIN='preview-agent@example.test'
export AGENT_BOOTSTRAP_NAME='预览 AI 管理员' # 可选

DREAMCORE_PREVIEW_AGENT_BOOTSTRAP=true SPRING_PROFILES_ACTIVE=local \
  java -jar apps/api/target/workspace-api-0.1.0-SNAPSHOT.jar --bootstrap-agent-admin
```

必须显式设置 `DREAMCORE_PREVIEW_AGENT_BOOTSTRAP=true`，active profiles 非空且全部属于 `local`、`trial`；`local,trial` 也允许。包含 `prod`、`production` 或任何其他 profile 均拒绝，守卫在 Spring 刷新和数据库迁移之前执行。命令以非 Web 上下文运行，执行后退出；配置不合法或已存在任意 `AGENT_ADMIN`、同登录名账号时非零退出，不覆盖、不改密、不修改凭据版本。不要把此命令加入常规启动脚本。

一次事务仅创建 ACTIVE 账号、独立第四端哈希凭据及 `AGENT_ADMIN` 角色，并用 `IdentityAudit` 记录动作和账号 id；不授 `PLATFORM_ADMIN`，不建立企业成员关系，不写企业功能授权，不增加迁移或 HTTP 创建口。

创建后通过正常第四端登录：先 `GET /api/agent-admin/v1/auth/csrf`，保留预登录 cookie，带 `X-CSRF-TOKEN` 调 `POST /api/agent-admin/v1/auth/login`（`username`、`password`）。成功后使用独立 `DREAMCORE_AGENT` 会话；该会话不能访问客户侧、企业管理侧或平台总台。口令只从上述私有文件安全读取，不打印请求体或 cookie。`preview-seed-accounts.py` 的 #16/#17 暂不负责建号和登录核验，见 [QUEUE 仅预览技术债](../../docs/codex-tasks/QUEUE.md)。
