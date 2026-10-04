# 梦核业务平台

Java 21、Spring Boot 4.1.1、Maven Wrapper 3.9.14。M1-A1 的运行状态/引擎适配之上，M2-A1 已加入 PostgreSQL、Flyway、Spring Security 和 JDBC 持久会话；身份接口可运行。M2-B1 已接入[三端网页登录与邀请](../../README.md#三端身份入口m2-b1)，M2-B2 已接入总台企业开通、停用/恢复、初始邀请与管理记录；M2-B3 已实现企业成员、邀请、共享空间授权、企业设置与管理记录。

M2-B4 提供启动本机专用数据库、平台、预览网页及受控初始化的统一入口，见[本地三端试用指南](../../docs/交接/本地三端试用指南.md)。`npm run trial:build` 后执行 `npm run trial:start`，`trial:stop` 保留数据；无需手工配置连接到其他项目数据库。以上为 M2-B4 状态；M2-C1 原件服务与新增迁移/契约见下方资料章节。

## 构建与验证

在仓库根目录执行（JDK 21、Python 3、PostgreSQL 18 的 `initdb` / `pg_ctl` / `psql` 在 PATH；完整测试含本地解析，当前需 macOS 的 Poppler/Tesseract 和沙箱）：

```bash
npm run setup:parser -- --with-tests
npm run test:api
npm run test:identity:restart
```

`test:api` 建立独占的临时数据库，执行真实 HTTP/权限测试并打包；`test:identity:restart` 使用该包验证 CLI 初始化、进程重启后账号/企业/会话保留、退出及默认安全 Cookie。每次命令各自创建并销毁测试数据库，只用合成数据；不连接现有服务。可用 `POSTGRES_BIN` 指定 PostgreSQL 二进制目录。

已有**本项目专用测试库**并注入下述环境变量时，也可执行 `./apps/api/mvnw -f apps/api/pom.xml test package`。测试会写入合成账号，不能指向开发工作库、客户库或生产库。仅打包用 `./apps/api/mvnw -f apps/api/pom.xml -DskipTests package`。Windows Maven 使用 `apps\api\mvnw.cmd`；当前临时数据库与私有投递文件验证使用 POSIX 文件权限，已验证 macOS，未验证 Windows 开发环境。

## 启动

先准备本项目专用 PostgreSQL 数据库和有迁移权限的账号，将 [示例配置](.env.example) 对应值注入进程环境。示例文件不会自动加载，不能使用示例占位密码。

| 环境变量 | 用途 / 默认值 |
| --- | --- |
| `DATABASE_URL` | 必填 JDBC PostgreSQL URL；不会自动选择其他项目数据库 |
| `DATABASE_USER` / `DATABASE_PASSWORD` | 必填，通过私有环境配置 |
| `SPRING_PROFILES_ACTIVE=local` | 仅本机开发：允许 HTTP Cookie，开启本地邀请投递；线上不可启用 |
| `INVITATION_OUTBOX` | 本地投递目录，默认 `./.local/invitations`；目录 0700，文件 0600 |
| `INVITATION_DELIVERY` | 默认 `disabled`；local profile 默认为 `local`，非 local 环境禁止本地投递 |
| `API_HOST` / `API_PORT` | 默认 `127.0.0.1` / `18181` |
| `ENGINE_BASE_URL` / `ENGINE_TIMEOUT_MS` | 默认 `http://127.0.0.1:18182` / `1500`；身份接口不依赖引擎启动 |

```bash
java -jar apps/api/target/workspace-api-0.1.0-SNAPSHOT.jar
```

启动自动执行 Flyway V1—V6：V1 身份/企业、V2 会话、V3 企业管理版本/初始管理员邀请映射、V4 企业成员/共享空间管理、V5 资料与独立维护权限、V6 解析任务与固定片段，禁止 Flyway clean。V3 会从既有企业最早的 TENANT_ADMIN 邀请回填初始邀请映射；不会改写原凭据、成员或会话。默认 Cookie 为 `DREAMCORE_SESSION; HttpOnly; Secure; SameSite=Lax`，30 分钟不活动过期；生产需 HTTPS。默认不信任转发头、不开放跨域。后续代理与部署配置单独验证；本批未部署。

## 首位平台管理员

在受控终端创建含初始密码的 **0600 普通文件**（密码 15–128 字符），注入 `BOOTSTRAP_PASSWORD_FILE` 的绝对路径、`BOOTSTRAP_EMAIL`，可选 `BOOTSTRAP_NAME`；不要把密码放入命令行、提交、文档或终端输出。沿用数据库环境，执行：

```bash
java -jar apps/api/target/workspace-api-0.1.0-SNAPSHOT.jar --bootstrap-admin
```

此命令不启动 HTTP 监听，通过事务锁防止并发初始化；已有平台角色时拒绝，不覆盖已有账号/密码。成功后自行删除该密码文件。没有公开注册或 HTTP 引导管理员接口，也没有通用预置密码。管理员恢复、密码重置和 MFA 不在本批交付范围。

## 已实现的身份流程

接口的精确请求/响应见 [identity.openapi.json](../../contracts/public-api/identity.openapi.json)，前端类型见 [identity.ts](../../contracts/public-api/identity.ts)。

1. `GET /api/v1/auth/csrf` 获取 Cookie、`token` 和 `headerName`。**所有写请求**（含登录/接受邀请）都带对应 header 和 Cookie；登录成功后重新获取 CSRF。
2. `POST /api/v1/auth/login` 邮箱密码登录；`GET /api/v1/me` 返回本人账号、平台身份和有效企业成员身份。
3. 平台身份调用 `POST /api/platform-admin/v1/tenants` 开通企业并产生初始企业管理员邀请；GET 只列出企业 id/name/status。
4. 在本地私有投递目录读取邀请 UUID 对应文件。令牌只用于测试客户端提交 `POST /api/v1/auth/invitations/accept`；新账号提交姓名和密码，再显式登录。**已有账号必须先登录对应邮箱本人，并省略姓名/密码**，邀请不能重置已有密码。
5. 企业管理员调用 `/api/tenant-admin/v1/tenants/{tenant}/invitations` 列出/邀请普通成员，DELETE `/{id}` 撤销。用户接受后建立企业成员与其个人空间。
6. `GET /api/v1/tenants/{tenant}/context` 返回有效企业身份与可见空间元信息；`POST /api/v1/auth/logout` 销毁服务端会话。

开通/邀请的 `requestId` 是调用账号内的幂等键，相同内容返回同一资源，不同内容返回 409。邀请默认 72 小时、256 bit 随机令牌，数据库仅保存 SHA-256 摘要；并发接受只成功一次。已撤销/过期/接受的令牌无法创建成员。过期状态读取时立即生效，新邀请时释放旧记录的待接受唯一位。

密码采用带盐的 PBKDF2-HMAC-SHA256 600,000 次迭代及算法版本前缀。登录按邮箱/IP 的哈希桶限流，默认 15 分钟 10/100 次尝试（包含成功尝试）；当前直接使用连接 IP，不解析客户端伪造的转发头。代理部署前需要校准可信代理和限流策略。认证事件/身份管理写入元信息审计，不存正文、密码或邀请令牌。

## 总台接口（M2-B2）

已实现契约见 `identity.openapi.json`（1.1.0）与 `platform-admin.ts`，三个端继续使用原 Cookie/CSRF。所有下述请求均校验当前平台角色，企业管理员或普通成员不能使用。

| 路径（前缀 `/api/platform-admin/v1`） | 能力 |
| --- | --- |
| `GET /overview` | 企业真实数量、平台/数据库连接检查、邀请投递模式；没有模拟额度/账单 |
| `GET /tenants?q=&status=&offset=0&limit=50` | 保留 Tenant 数组；名称包含搜索、状态过滤；limit 1–100，offset 0–1000000；创建时间/ID 倒序 |
| `POST /tenants` | 原开通接口：企业名、初始管理员邮箱、requestId；投递失败回滚 |
| `GET /tenants/{id}` | 企业、管理版本、开通时间、有效成员/空间数量、初始邀请元信息 |
| `POST /tenants/{id}/status` | requestId、expectedVersion、ACTIVE/SUSPENDED；停用或恢复 |
| `POST /tenants/{id}/initial-admin-invitation` | requestId、expectedVersion、email；仅尚未加入的初始管理员可更新邀请 |
| `GET /tenants/{id}/records?offset=0&limit=50` | 平台开通、停用、恢复、初始邀请更新的成功记录；不含员工工作/登录事件 |

版本过期返回 `STALE_TENANT_VERSION`，不覆盖他人的更新。相同 requestId/内容重试不再执行，返回当前详情；例如停用后已经恢复，再重试旧停用请求不会重新停用。相同键不同内容返回 `IDEMPOTENCY_CONFLICT`。前端结果不确定时保持原内容/请求重试，操作处理中暂不关闭弹窗。

停用保留账号和成员关系；请求时企业授权拒绝，其他企业身份不变。未接受邀请暂停使用，恢复后仍需未过期且未撤销；已停用成员不会因企业恢复而启用。M2-C1 已加入资料与下载权限验证，M2-D1 已完成当前服务的撤权矩阵，M3/M4 接入检索和引擎任务后继续验证，不能据本切片声称全链路撤权已完成。

初始邀请更新仅 ACTIVE 且未接受时允许，新邀请与旧邀请撤销同事务。新投递失败时旧邀请保持有效；初始管理员加入后拒绝更换，不能用此接口夺取已有管理员身份。邀请令牌仍只在本地私有投递文件，由受控开发环境取得并在 `/tenant-admin/#invite=<令牌>` 激活，不经总台 API、页面、日志或管理记录返回。

管理接口位于独立 `PlatformAdminController/Service`，复用身份授权/幂等原语，不加入客户业务数据查询。企业锁先于邀请锁，使停用、更新邀请、接受邀请的并发结果可解释。

验证：`npm run test:api`（包含已填充 V2 数据库升级最新 V5 的检查）、`npm run test:platform-admin`、`npm run test:identity:restart`；见[总台记录](../../docs/交接/M2-B2总台管理与验证-2026-09-22.md)。

## 权限与后续边界

- 平台角色与企业成员关系分表；总台不会自动成为客户企业成员，没有读取正文、会话、代入或导出入口。
- 企业、账号、成员、角色的当前状态由服务端重新检查。企业管理员不能因此读取其他员工个人空间；共享空间只为拥有者或明确成员返回元信息。
- 数据库以 tenant_id 组合外键约束空间归属；查询仍需显式授权和企业过滤。本批未启用数据库 RLS，不能代替基础设施账号权限控制。
- 首期投递只在本地，未发送邮件；默认生产模式无法创建邀请并返回 503，相关业务写入回滚。未来真实投递需接入可靠出站队列/服务商，不能把当前文件投递直接作为生产邮件系统。
- M2-B2 已交付总台初始管理员邀请更新、停用/恢复及管理页面；M2-B3 已交付成员/共享空间核心管理，自授权和管理员任命待确认；M2-C1 已覆盖文件与下载授权，M2-D1 已完成当前范围撤权/停用验收。M2-C1 已接资料原件上传/版本/下载；M3-A1 已接本地文件解析；模型、Harness、WeKnora 与会话内容未接入。
- `GET /actuator/health` 和 `/api/v1/system/info` 保持公开的基础状态；其他未登录请求拒绝。引擎不可达返回 503、协议不兼容返回 502，不回退 Demo。

实现决定见 [DEC-048](../../docs/技术/开发决策记录.md#dec-048m2-a1-身份与租户基础实现2026-09-22)，证据见 [M2-A1 验证记录](../../docs/交接/M2-A1身份与租户基础验证-2026-09-22.md)。

## 企业管理接口（M2-B3）

前缀 `/api/tenant-admin/v1/tenants/{tenant}`。全部要求当前有效的本企业管理员；平台管理员不会绕过企业成员校验。路径内 `workspace` 仅允许本企业 SHARED 空间。

| 方法/路径 | 用途 |
| --- | --- |
| GET `/overview` | 企业名称、设置版本、成员/共享空间真实数量、邀请投递模式 |
| POST `/settings` | 修改企业名称，`requestId/expectedVersion/name` |
| GET `/members?q=&status=&offset=0&limit=50` | 成员姓名、邮箱、角色、成员/账号状态、版本 |
| POST `/members/{account}/status` | 本企业成员 ACTIVE/DISABLED，带请求键与成员版本 |
| GET/POST `/invitations`、DELETE `/invitations/{id}` | 复用邀请服务；列表增加有界分页及最新优先排序 |
| GET/POST `/workspaces` | 搜索分页列表 / 创建共享空间（请求键＋名称） |
| GET `/workspaces/{workspace}` | 管理元信息，不返回内容 |
| POST `/workspaces/{workspace}/settings` | 改名，带请求键与空间版本 |
| GET `/workspaces/{workspace}/members` | 分页授权名单（含停用状态） |
| POST `/workspaces/{workspace}/members/{account}` | `requestId/expectedVersion/enabled` 新增或撤销授权 |
| GET `/records` | 本企业管理记录，目标和授权成员 ID，不含私有工作内容 |

所有列表 offset 0—100000、limit 1—100，默认 50。企业名称使用独立 `settings_version`；成员状态和空间授权各自用资源版本。相同账号的请求键跨操作不可复用；成功重试返回当前状态、不重放旧动作。修改先获取请求键锁，再获取企业行锁，再复查实时权限；读操作与邀请事务持有企业共享锁，避免授权校验与管理员停用交错。Flyway 仅追加 V4，保留 V1—V3。

`LAST_TENANT_ADMIN`、`STALE_MANAGEMENT_VERSION`、`MEMBER_INACTIVE` 返回 409。自授权规则未确认，新增自己的共享空间授权暂以 `SELF_GRANT_NOT_ENABLED` 返回 403；任命管理员暂无 API。保留已存授权不等于停用期间可以访问。测试命令：`npm run test:api`、`npm run test:tenant-admin`、`npm run test:identity:restart`。

## 资料原件与版本（M2-C1）

独立模块位于 `com.dreamcore.workspace.material`，公开契约见 [material.openapi.json](../../contracts/public-api/material.openapi.json)，TS 类型见 [material.ts](../../contracts/public-api/material.ts)。授权复用当前企业/成员检查，原件通过 `ObjectStore` 接口适配，不交给引擎或第三方资料库持有唯一事实。

| 配置 | 用途 |
| --- | --- |
| `MATERIAL_STORAGE_ROOT` | 显式配置的本项目私有原件目录，必须 0700；未配置或不可用时上传/下载明确失败。仅本机适配，不作为网页静态目录 |
| `MATERIAL_MAX_BYTES` | 单文件上传上限，默认 20971520（20 MiB），范围 1–67108864；不能靠客户端绕过 |

试用启动器自动使用所属 `.local/trial/objects`，隔离测试使用临时目录，不继承其他项目原件配置。原件为 0600 不可变文件，键由服务端产生、与文件名分离；下载读取并校验大小和 SHA-256，强制附件而不按上传 MIME 执行 HTML/SVG。降低上传上限不影响读取以前合法上传的较大版本（最高 64 MiB）。

| 路径（前缀 `/api/v1/tenants/{tenant}`） | 能力 |
| --- | --- |
| `GET /library` | 本人可见企业共享资料汇总，不含任何个人空间 |
| `GET /workspaces/{workspace}/library` | 当前目录列表；`q` 非空时按名称搜索整个当前空间；返回完整路径与维护标记 |
| `POST /workspaces/{workspace}/folders` | 同空间创建子目录，requestId 幂等，最大 32 层 |
| `POST /workspaces/{workspace}/materials` | multipart：JSON `metadata`（requestId、可选 folderId）＋`file`；形成稳定资料 ID 与 v1 |
| `POST /workspaces/{workspace}/materials/{material}/versions` | metadata 携带 requestId、expectedVersion；新增不可变历史版本，不接受 folderId 变更 |
| `GET /workspaces/{workspace}/materials/{material}` | 资料元信息与倒序版本，offset/limit 分页 |
| `GET /workspaces/{workspace}/materials/{material}/versions/{version}/download` | 再验当前权限后下载固定版本；无公开对象 URL，无浏览器缓存 |

资料目录与版本列表默认每页 50，允许 1–100；客户端分别用 24/20。资料列表根目录分页也包含文件夹。相同目录下文件夹同名会冲突；上传同名原件会创建独立资料，只有明确“上传新版本”才更新原条目。

V5 为已有共享成员增加 `can_maintain=false`，创建资料目录、资料和版本表，组合外键限制企业与空间归属，当前版本引用在事务提交时验证。新增管理接口为 `/api/tenant-admin/v1/tenants/{tenant}/workspaces/{workspace}/members/{account}/maintenance`，请求仍是 requestId/expectedVersion/enabled；要求已有访问权，由本企业管理员操作。撤销访问删除维护权，重新加入仍为只读；自授权仍拒绝。新增管理记录仅反映权限授予/取消，不暴露个人文件活动。

上传先校验访问，再对请求键和内容摘要作幂等处理；持有当前授权及资料行锁后核对版本。失败不返回假成功；数据库回滚会清理本次原件，异常崩溃留下的未引用对象不对外可读。生产存储的备份、还原、孤儿清理、容量和断电一致性仍在 M7 验证；本批不删除原件或历史版本，不提供范围下载/大文件断点续传。

运行 `npm run test:api`、`npm run test:materials`，证据见[资料接入记录](../../docs/交接/M2-C1资料真实接入与验证-2026-09-22.md)。原件尚未解析，上传不代表 AI 已理解；资料引用/发布、全文检索与索引状态由后续模块接入。

## 撤权与等待锁复核（M2-D1）

`IdentityService.member` 在取得企业锁后重读账号及成员状态；总台企业开通在请求键等待后复核平台身份，企业状态和初始邀请更新在请求键/企业锁之后复核。成功请求的重试同样重新授权，不凭历史请求键返回已失去权限的资源。未增加迁移或改变公开请求/响应契约。

`RevocationIntegrationTest` 覆盖 7 类状态变化、恢复语义、5 类锁等待和 3 条总台排队写路径；全部后端共 52 项通过。全局账号/平台角色状态通过合成测试夹具变更，产品没有因此新增账号停用或平台角色管理入口。真实浏览器命令 `npm run test:revocation` 包含完整三端/资料流程。规则、失败复现及证据见[撤权验收记录](../../docs/交接/M2-D1撤权与停用验证-2026-09-23.md)。


## 本地知识接口（M3-A1）

见 [Knowledge OpenAPI](../../contracts/public-api/knowledge.openapi.json)。`KNOWLEDGE_ENABLED` 默认 false；启用需 `KNOWLEDGE_PARSER_ROOT` 指向受信任的 `workers/parser` 绝对路径，并按其 README 安装运行依赖。试用启动器在本工作树安装解析 venv 后自动启用；不会继承其他项目的 KNOWLEDGE 环境配置。

启用后上传同事务排队，维护者可按固定版本手动请求解析；读取状态/预览要求访问权，发起/执行/写回要求维护权。已持久化的内容无需执行器即可读取。任务在 120 秒租约过期后恢复，最多 3 次；迟到结果拒绝写回。正文及错误详情不进入管理日志。

`test:api` 中 KnowledgeIntegrationTest 实际调用本机沙箱；先运行 `npm run setup:parser -- --with-tests`，需 macOS Poppler/Tesseract 环境。跨平台执行器、远程 WeKnora 与云部署另行验收。内容关键词查询默认只使用当前版本最新 READY/PARTIAL 批次，最多 8 个关键词，单次 3 秒；旧版本及旧解析来源通过固定引用读取并再次鉴权。

## 私人会话与本地任务（M4-A1 首个切片）

`conversation` 模块提供 [Conversation OpenAPI](../../contracts/public-api/conversation.openapi.json)：创建/读取私人会话、异步资料查找、取消/明确重试和按游标读取事件。V7 保存会话、任务、事件与固定来源引用；共享空间会话仍仅本人可读，管理角色无内容旁路。

默认 `TASK_ENABLED=false`；启用需 `ENGINE_BASE_URL` 和不少于 32 字符的 `TASK_ENGINE_TOKEN`，与独立引擎一致。试用启动器自动配置，仅提供本地关键词查找，不调用模型。成功由平台记录和引擎响应校验共同决定，界面明确显示未调用模型。

运行记录 30 秒租约，过期改为 INTERRUPTED 等待明确重试；取消后旧尝试不能写回。网络失败的发送复用原 requestId。当前事件轮询不是模型流式回复，也不代表已实现远端工具进程取消。状态、权限与替换影响见 [M4-A1 技术边界](../../docs/技术/M4-A1会话与本地任务边界.md)。`npm run test:conversations` 在独立临时环境运行真实三端/浏览器流程；正常重启保留会话和引用。

## 平台 Agent 任务（M4-A1 第三切片）

V8 加入 Agent 执行类别、回复、用量、短期资料授予和私有工具产物。`AGENT_TASK_MODE=off` 默认关闭；verification 仅用于合成联调，live 要与真实引擎配置一致。公开会话 API 不返回执行凭证。Agent 为 60 秒租约；过期仍等明确重试。回复/工具产物写回与下载都重新授权，不能由模型自述标记成功。

内部回调不要求浏览器 CSRF，而是验证当前任务的尝试凭证；企业、空间和发起人完全来自平台数据库。最大 8 个/合计 64 KiB 的真实小产物暂存 bytea，不自动加入资料库。浏览器取消已传播到引擎及模型 HTTP 正文，详见[技术边界](../../docs/技术/M4-A1模型网关与平台Agent边界.md)及[本轮验证](../../docs/交接/M4-A1模型网关与平台Agent验证-2026-09-23.md)。

## 公开检索任务（M4-A1 第四切片）

V9 保存 `public_query`、`web_sources` 和 `skills`；会话 API 1.2.0、Agent 结果 1.1。`AGENT_PUBLIC_WEB_ENABLED=false` 默认，需与引擎一致开启；页面仅在已启用的 Agent 模式展示公开输入。该字段在发送时固定并进入请求幂等，SOURCE_LOOKUP 不支持。来源和能力回执经服务端校验后与结果原子保存，继续执行私人会话访问规则。

`npm run test:agent` 现覆盖目录→检索 HTTP→页面→来源持久化的合成流程。当前配置、实际验证及升级限制见[技术边界](../../docs/技术/M4-A1可信目录与公开检索边界.md)，不是未知工具自动安装或真实云模型验收。

## 任务原件版本授权（M4-A1 第七切片）

Flyway V10 新增任务选定版本及按尝试保存的读取事实，复合外键约束企业/空间/资料/版本。会话 API 1.3.0 通过 originals 选择最多 3 份固定版本，平台独立核对查看权限和大小（单份 256 KiB、合计 512 KiB）；仅 AGENT verification 接受非空选择，普通试用仍默认关闭。指定原件时关键词检索也只使用这些历史版本；其他检索保持最新版本行为。

内部 `/internal/v1/agent-access/{task}/originals`、`/read-original` 使用现有尝试 Bearer，后者只接受 versionId，不接受路径、存储 ID 或自报企业。读取前后检查权限/租约；Agent 1.3 返回 originalIds 必须与本次实际读取集合一致。取消、重试、版本固定及私人产物规则见[技术边界](../../docs/技术/M4-A1原件授权与版本边界.md)。平台与引擎需配套升级，不能直接降回不认识原件范围的旧版后继续执行旧任务。

## 内置文件配方（M4-A1 第八切片）

平台接受 Agent 1.4 的 process_original 回执，必须处于 verification、激活 file-processing 并确有本次原件读取记录，继续原子保存私人成果。TASK_FILE_UNSUPPORTED/ENCODING/INVALID/LIMIT/DATA 进入失败代码白名单，页面按原因引导修改。数据库仍 V10；升级与结果边界见[配方说明](../../docs/技术/M4-A1完整文件处理配方边界.md)。

## 个人文稿（M6-A1 首个切片）

V12 保存文稿、不可变版本、精确幂等回执和导出缓存；文稿 API 1.0.0。创建只读取本人成功 AGENT 任务或 UTF-8 TXT/MD 产物；读写/导出均复核来源和私人所有权，管理角色无旁路。PDFBox 3.0.8、离线固定 OFL 字体和受限 OOXML 提供 Word/PDF，小缓存暂存 bytea；每个文件最多 2 MiB / PDF 100 页，渲染最多两个并发，非任意代码执行环境。运行无需 Office/Python或外网字体。

`npm run test:api` 包含文稿权限、重试、并发与真实导出检查；`npm run test:agent` 接续真实浏览器保存/编辑/下载和撤销验证。全文限制、字体覆盖、回退和共享待办见[边界](../../docs/技术/M6-A1个人文稿与导出边界.md)。


## 明确共享发布（M6-A1 第二切片）

V13 保存私人文稿固定版本与独立企业文件版本的映射、回执及去重约束。文稿/资料 API 1.1.0；`POST /api/v1/tenants/{tenant}/documents/{id}/versions/{version}/publications` 仅接受请求键、目标、预期企业版本、格式和独立副本确认；不接受正文/所有者。`GET /api/v1/tenants/{tenant}/documents/{id}/publications` 仅供本人且过滤已失权目标。资料详情的版本增加 `origin=UPLOAD|DOCUMENT_PUBLICATION`，不公开私人来源 ID。

发布复查源权限及目标维护权，明确更新与普通上传共用版本锁。共享读者只按目标权限读取，来源撤权/发布者停用不撤回企业副本。独立存储、事务回滚、幂等重试、解析状态和升级顺序见[边界](../../docs/技术/M6-A1共享发布与企业版本边界.md)。`npm run test:api` 包含发布专题；`npm run test:agent` 覆盖真实 HTTP/浏览器联调。


## 经验自动积累：来源登记切片（B4，尚未完整启用）

`EXPERIENCE_INTAKE_ENABLED=false` 为默认值。开启后每 30 秒发现已记录成功尝试的 live 任务与有效反馈，只保存企业、原主体、空间、来源身份、版本及尝试号；不复制会话、反馈正文，不调用模型，不向总台上送，也没有新增管理员读取私人内容的接口。每轮分别最多发现 100 条任务与 100 条反馈，再轮转复核最多 300 条待处理来源。

登记不是经验入库，更不是人工审核队列。受影响成员资格/空间授权变化立即使既有登记失效；来源版本、生命周期、资料/数据库依赖在使用前重新核验，已标记失效的同一来源版本不自动恢复。企业暂停不等于来源质量不合格，但暂停期间不新增来源；后续实际提炼仍须另行核验执行资格。`verification` 执行及其反馈不作为真实任务经验。

本切片包含 V68 来源登记及 V69 生命周期递归查询修正。V69 先选中实际依赖，再逐个检查，避免 SQL 优化器在过滤前递归无关对象。完整自动提炼、质量验证、准入、通用经验脱敏上送及观察页面仍待后续完成，旧手工经验接口尚未替换；暂不建议对验收实例启用本开关。迁移编号还须按[五批实施记录](../../docs/交接/管理端五批实施记录-2026-10-04.md)与主链整合。

合成数据库验证：

```bash
python3 scripts/with-test-postgres.py ./apps/api/mvnw -f apps/api/pom.xml -q -Dtest=ExperienceIntakeIntegrationTest,ObjectLifecycleIntegrationTest,ProfileMethodLifecycleIntegrationTest,FeedbackIntegrationTest,PublicationFeedbackIntegrationTest,FeedbackAdjustmentIntegrationTest,TaskDatasetIntegrationTest,TaskContextIntegrationTest test
```


### 经验提炼引擎适配（接续）

`ExperienceAnalysisRuntime` 已连接内部 experience 1.0 的运行描述、POST、GET 恢复与 DELETE 取消；固定 run/lease/source、引擎版本和 live/verification 类别。接收回执时重新检查两阶段、非空实际调用、全部核验项、引用原文、当前提供的现有版本及敏感标识；坏回执按结果未知处理，不冒充质量不合格。响应丢失后只查询原回执，不自动重新 POST。未发送的来源失效与已发送的未知结果分开。

当前适配器尚未与来源登记扫描器、持久派发账本和自动准入连接，不能算已启用自动积累。默认扫描开关仍关闭，不新增公开页面或写入经验版本。真实 HTTP + 实际 Harness 两阶段验证使用合成 ModelPort，命令及资源限制见[引擎说明](../../engine/README.md#经验提炼与自动核验b4-内部协议-10)。
