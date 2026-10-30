# CT-037 现网挂载 + 桌面/手机冒烟（M4）

状态：执行单可交　｜　轨 **C 交付**　｜　分支（执行时）：`codex/ct-037-prod-mount-desktop-mobile-smoke`　｜　**审查人（两人审）：发布验收 + 质量性能**（架构逻辑可选；diff 出现 Java / 契约 / 迁移则架构改为必审并打回）　｜　基准：`origin/main` `75ab17a`（CT-034-A 实现 #30）　｜　日切片：**D9～D14（11-08～11-13）/ 可演示点**：现网 URL 能打开四端；桌面冒烟勾完 M1～M3 里已合的路径；手机 390 有上架空态、开通空态各 1

> **挂靠**：两周 M4 · 验收句 **S1–S4**（[两周主路径验收句](https://www.notion.so/40966c386fbf81ad97cff544bc2906ff)）。日表 [`两周日切片-三轨并行-20261031.md`](两周日切片-三轨并行-20261031.md)。  
> **谁做什么**：交付运维勾清单、准备预览 URL、写只读核对记录。**发布验收**截下面规定的关键屏并做体验走查。现网切换、DNS、证书、Nginx 重载、改 env **只由部署负责人 `luofanghao9784` 执行**。本单的 Codex 提示词只跑清单和只读命令。  
> **终签**：表里还有【待合】时，M4 / S1 不能签过。执行单入库只表示清单齐，不表示现网已切、冒烟已绿。

规格依据：

- 验收句 S1–S4、W1–W5、L1–L4、E1–E4：上列 Notion 页
- 门禁体验口径：`docs/验收/梦擎审查门禁与分工流程.md` §4.5（主路径 + 桌面 + 手机 390；至少一种浏览器跑通）
- 现网入口记录（对照用，当日再核，不当成免查结论）：[`menginework正式入口执行记录-2026-10-27.md`](../交接/menginework正式入口执行记录-2026-10-27.md)、[`ICP备案通过与正式域名上线交接-2026-10-27.md`](../交接/ICP备案通过与正式域名上线交接-2026-10-27.md)
- 预览：`scripts/preview/preview-health.sh`、`scripts/preview/preview-start.sh`（只听 `127.0.0.1`）
- 已合行为：CT-034-A、CT-035、CT-034-P1、CT-038、CT-036 空态壳 `#25`

## 依赖（对照 `75ab17a`）

| 编号 | 实况 | 清单 |
|---|---|---|
| CT-034-A | **已合** `#30` / `75ab17a`。`POST /api/agent-admin/v1/capabilities` 在第四端会话 + CSRF 下落库 **201** | 接口写通可勾。页面「保存登记」仍是 CT-038 灰钮，点击落库另见下表【待合】 |
| CT-035 | **已合** `#21` / `bd06caf`。Cookie `DREAMCORE_AGENT`，`/api/agent-admin/v1/auth` 的 csrf / login / me / logout | 接口登录隔离可勾。第四端页面仍是「预览页面 · 无需登录」，没有登录表单 |
| CT-034-P1 | **已合** `#22` / `022768b`。未登录写 **401** 人话；有会话无 CSRF **403**；开放链已删 | 可勾 |
| CT-038 | **已合** `#15` / `e339056`。导航为人话；后三按钮灰 | 文案与空态可勾 |
| CT-036 | 骨架 `#18` 已合；诚实空态壳 `#25` / `7e21bc0` 已合（tenant「已开通」、workspace「质量检查」三步，提交钮灰）。接读口、提交材料出结果 **未合** | 空态可勾。真名单与提交出结果 **【待合】** |
| CT-039 | 执行单 `#29` 已合；`GET /api/tenant-admin/v1/opened-capabilities` **实现未合** | 企业侧真「已开通」名单 **【待合】** |
| CT-040 | 本基准无 `docs/codex-tasks/CT-040*.md`，无合入 PR | 凡写明依赖 CT-040 的行 **【待合】**。本单不猜测它改哪些文件 |

## ① 目标与范围

- **目标**：给 D9～D14 一张可勾的交付清单。D9 用本文件把域名、反代、env 点名；D10 由部署负责人按切换步骤挂上含 `75ab17a` 或其后裔的版本；D11 桌面走通 M1→M2→M3 里已经合入的路径；D12 手机 390；D13 用文末那句回滚复跑；D14 只在【待合】清空后终签。
- **执行时允许改的文件**：默认零代码。若要把当次勾选记进仓库，只新增 `docs/codex-tasks/` 下一条冒烟记录（无截图原件、无口令、无 env 内容）。不改 `apps/api/**`、`engine/**`、`src/**`、`contracts/**`、`.github/workflows/**`。
- **不做什么（非范围）**：自托管 runner（CT-033 一类）、四端全面抛光、批量开通 / 批量运营、版本页与开通页的精致可写、替 CT-039 / CT-040 / CT-036 写实现、采购新域名、安装 `scripts/deploy/nginx-ai.conf.example`（那是 `ai.9pop.top` 旧例）。

### 现网挂载：域名 / 反代 / env

当日先只读核对，再决定是否切换。记录里写「核对日期 + 命令结论」，不贴 env 文件、Cookie、证书私钥、账号口令。2026-10-27 的入口记录只作对照。

| # | 核对 | 对照（仍须当日再读） |
|---|---|---|
| H1 | 正式域名仍是 `menginework.com`；权威 DNS 与至少一处公共 DNS 的根域 A 指向**当时**实例公网 IP | 记录过根域 A → `121.40.44.117`、TTL 600。IP 变了就停，问部署负责人，不沿用旧 IP |
| H2 | 同域四条路径都能打开：`/workspace/`、`/tenant-admin/`、`/platform-admin/`、`/agent-admin/` | 2026-10-27 记录覆盖前三端。`/agent-admin/` 若公共入口里没有，由部署负责人按同域补到专用配置，不另起默认 nginx |
| H3 | 专用网页配置仍是 `/etc/nginx/mengine.conf`，公共入口 `/etc/nginx/mengine-public.conf`。80 只做 ACME 与跳到该域名的 HTTPS；443 转到回环 `127.0.0.1:18480` | 默认 nginx 保持 mask。语法检查用 `nginx -t -c /etc/nginx/mengine.conf`，再重载 `mengine-web` |
| H4 | API、引擎、数据库端口不进公网 | 初始化记录为 API `18181`、引擎 `18182`、PG `18432`，均绑回环。以当日 `ss` 为准 |
| H5 | 证书 SAN 含 `menginework.com`，浏览器不告警；HTTP 进该主机名会到 HTTPS | 记录过 Let's Encrypt，到期日以当日证书为准 |
| H6 | 公网会话仍能认出 HTTPS | 曾补 `server.forward-headers-strategy=framework` 与 `server.servlet.session.cookie.secure=true`。不改整个 Spring profile |
| H7 | 三枚 Cookie 不同名：`DREAMCORE_SESSION`、`DREAMCORE_PLATFORM`、`DREAMCORE_AGENT` | 只核名称与 Secure/HttpOnly，不记录值 |
| H8 | 现网没有预览专用变量 | 不写入 `MENGINE_API_URL`、`PREVIEW_HOME`、`PREVIEW_PHONE_LOCAL`。既有 `AGENT_TASK_MODE` 等开关本单不改，记录里不打印取值 |

### 预览 → 现网切换（仅部署负责人，D10）

1. 在老板 Mac 用预览把下文「可勾」行走完，记下预览 `webUrl` 与 `git rev-parse HEAD`。该提交必须含 `75ab17a`。
2. 只读记下切换前的 `readlink -f /opt/mengine/current`、Flyway 成功版本、`mengine-api` / `mengine-engine` / `mengine-web` 是否 active。
3. 做当日备份（库、对象、Nginx、env）并核对摘要。备份失败则停，不切换。
4. 把该 SHA 的网页与 API 发布到新 release，`/opt/mengine/current` 指向它。`/agent-admin/` 与 `/api/agent-admin/` 走已有 18480 反代。
5. `nginx -t -c /etc/nginx/mengine.conf` 通过后重载专用 `mengine-web`。要重启 API 时只重启 API，不更换 profile。
6. 只读看四端路径 200、匿名 `GET /api/agent-admin/v1/auth/me` 为 401、HTTP 跳 HTTPS。用合成账号做写通，不用客户资料。

**回滚（一句）**：若这次发布后入口或新静态包异常，部署负责人把 `/opt/mengine/current` 指回切换前记下的 release，对 `/etc/nginx/mengine.conf` 做语法检查后重载专用 `mengine-web`；这次发布之后新写入的业务数据不回滚数据库。

### 桌面冒烟（D11，先预览后现网）

桌面视口 **1440×900**。勾选顺序按 M1 → M2 → M3；操作上可以先登录再登记。至少一种浏览器跑通。控制台无未处理报错、无死链、无假成功 toast。

| # | 路径 | 怎么过 | 状态 |
|---|---|---|---|
| M1-a | 写通 · 接口 | 第四端已登录且 CSRF 有效时，`POST /api/agent-admin/v1/capabilities` 带新的 `capabilityId`、`name`，并带 `enterpriseFunction=quality-check`，返回 **201** 且能再读到该行。同一 `capabilityId` 再 POST 为 **409**，不覆盖原行 | 可勾（CT-034-A） |
| M1-b | 写通 · 门禁 | 无 Cookie 的 POST 为 **401**，人话，不落库。有 Cookie、无 CSRF 为 **403**，不落库 | 可勾（CT-034-P1） |
| M1-c | 写通 · 页面按钮 | 打开 `/agent-admin/#view=capability-registry&tab=catalog`，「登记实现方案」能开面板；「保存登记」仍 disabled，旁注为人话（现文「AI 功能登记暂不能保存（后台开通中）」一类） | 灰钮可勾。**点击保存并落库【待合】**：CT-038 把按钮钉灰，本基准没有把按钮接到 201 的前端单 |
| M1-d | 上架成真 / 开通给企业 | 「已上架」出现真实条目；「开通给企业」写出授权并能复验 | **【待合】**。无已合实现。若日后归 CT-040，仍待该号合入再勾 |
| M2-a | 登录隔离 · 第四端接口 | `AGENT_ADMIN` 合成账号：`POST /api/agent-admin/v1/auth/login` 成功后 `GET /me` 200；错账密人话（例：「账号或密码不对，请重新输入」）；`POST /logout` 后 `/me` 401。客户 Cookie、总台 Cookie 访问第四端 `/me` 为 401。企业账号登第四端被拒且人话 | 可勾（CT-035）。口令不进 PR |
| M2-b | 登录隔离 · 另外三端 | 总台、企业负责人、员工各自能进 `platform-admin` / `tenant-admin` / `workspace`；登出后看不到上一账号的数据 | 可勾（沿用既有登录页 + 合成账号） |
| M2-c | 第四端页面登录表单 | 在 agent-admin 壳上看到登录框并走完 L1 | **【待合】**。现页是免登浏览壳。接口绿不能代替这张表单 |
| M3-a | 企业已开通 · 空态 | 企业负责人打开 tenant-admin，能看到「已开通」，文案为暂时不能查看（后台开通中），没有假名单 | 可勾（空态壳 #25） |
| M3-b | 企业已开通 · 真名单 | `GET /api/tenant-admin/v1/opened-capabilities` 按本企业会话返回人话名；未开通为 200 且 `items` 为空；响应里没有别的企业 | **【待合】** CT-039 实现未合，CT-036 未接线 |
| M3-c | 质量检查 · 空态壳 | workspace `#tenant=<演示企业>&view=quality-check` 能看到三节：进入说明、提交检查材料（钮灰）、处理结果。灰钮旁注含「暂时不能提交检查材料（后台开通中）」 | 可勾（#25）。这是最小路径的诚实空态，不是提交出结果 |
| M3-d | 质量检查 · 提交出结果 | 进入 → 提交一份检查材料或约定演示包 → 看到处理结果或诚实进度 | **【待合】** CT-036 完整消费未合。若提交/结果归 CT-040，同样【待合】 |
| M3-e | 未开通企业看不到 | 未开通该功能的企业没有入口，直链打不开，响应不带其他企业名称 | **【待合】** 依赖 M3-b 的读口 |

【待合】行留在表上，不删、不改成「跳过即通过」。D11「桌面冒烟清单绿」只表示可勾行全勾，且【待合】行都写了缺哪一号；M4 终签仍要等这些行变成可勾。

### 关键屏（发布验收截，桌面 ≥3）

证据放老板 Mac 的 `~/Desktop/.smoke-qa-ct037-<日期>/`，不提交进 Git。每张图旁注 URL、视口、commit。截图人一律是 **发布验收**。交付运维不代截。

| # | 画面 | 视口 | 谁截 |
|---|---|---|---|
| S-D1 | 功能上架：同时看见「说明样例」与「已上架」（空态或诚实结果都可，禁止说明样例冒充已上架） | 1440×900 | **发布验收** |
| S-D2 | 登录隔离的可见页：错账密人话，或登出后不再显示上一账号。第四端没有登录表单时，改截企业端或总台的同一类人话，记录里写明第四端登录是 M2-a 接口 | 1440×900 | **发布验收** |
| S-D3 | tenant-admin「已开通」或 workspace「质量检查」三步，二者至少一张；两张都有更好 | 1440×900 | **发布验收** |

S2 还要求人话与定稿一致：企业功能 / 功能上架 / 版本 / 企业开通。发布验收在 S-D1 上顺带看这四个词。产品按验收句页勾选，UX 按体验标准看；任一方不过可拦。

### 手机冒烟（D12，宽 390）

视口宽度 **390**（高度可用 844）。浏览器开发工具或真机均可，记录里写清哪一种。

| # | 画面 | 要求 | 谁截 | 状态 |
|---|---|---|---|---|
| S-M1 | `/agent-admin/#view=capability-registry&tab=catalog` 的「已上架」空态 | 至少 1 张。标题可见（现文「暂时无法展示已上架的实现」一类），没有假条目 | **发布验收** | 可勾 |
| S-M2 | `/agent-admin/#view=capability-registry&tab=grants` 的「企业开通」空态 | 至少 1 张。能看出是企业开通，且是空态（现文「尚无可展示的企业开通记录」一类） | **发布验收** | 可勾 |
| S-M3 | 主路径不挡 | 390 宽下不必横滑就能点到：功能上架、企业开通、「登记实现方案」、tenant「已开通」、质量检查的灰钮「提交检查材料」。固定条不盖住这些主按钮 | 发布验收目检，可另附一张被挡住的失败图 | 可勾（只验不挡，不做全面抛光） |

## ② 前置条件与分支名

- **⓪ 暂停令自查（第一步）**：有暂停令或拿不准 → 不开 Codex，不问生产，停下来问 DQ。
- 正确仓：`~/Desktop/mengine-app-luofanghao9784`（origin=`luofanghao9784/mengine-app`）。
- 预览若未起：`PREVIEW_PHONE_LOCAL=1 bash scripts/preview/preview-start.sh`，端口以 `preview-health` / 启动输出为准。约定目标 web `50832`、api `50831`，不一致就写实测值。
- 现网写操作不在本分支里做。部署负责人用自己的通道，本提示词不包含 SSH 写、DNS、重载。

```bash
# ⓪ 暂停令自查：无暂停令再继续
REPO="$HOME/Desktop/mengine-app-luofanghao9784"
cd "$REPO"
git remote get-url origin | grep -q 'luofanghao9784/mengine-app' || { echo 'ERROR: 错误 remote，停'; exit 1; }
git status
git switch main && git pull
git merge-base --is-ancestor 75ab17a HEAD || { echo 'ERROR: main 不含 CT-034-A 75ab17a'; exit 1; }
git switch -c codex/ct-037-prod-mount-desktop-mobile-smoke
```

## ③ 完整提示词（整段复制）

把下面整段交给 Codex。模型 `gpt-6.1-sol`（本机已有 `gpt-5.3-codex` 亦可），思考强度 **medium**。这是清单和只读脚本，不要改 Java。

```text
你在梦擎仓库。只做 CT-037 的交付核对，不实现功能。执行单：docs/codex-tasks/CT-037-prod-mount-desktop-mobile-smoke.md。基准须含 75ab17a。

【你要做的】
按该文件①的表逐行填：可勾 / 【待合】 / 未跑。未跑要写原因。不要把【待合】改成通过。
依赖以该文件「依赖」表为准：CT-034-A、CT-035、CT-034-P1 已合；CT-039 实现、CT-040、CT-036 完整消费未合则对应行保持【待合】。
截图不由你代劳。桌面 S-D1、S-D2、S-D3 与手机 S-M1、S-M2 的截图人写「发布验收」。你只列出 URL 与视口，方便对方去截。

【只读命令】
在预览已就绪时运行（WEB 用 preview-health 打印的 webUrl，不要猜端口）：

  bash scripts/preview/preview-health.sh
  WEB="<webUrl>"
  curl -sS -o /dev/null -w 'workspace %{http_code}\n' "$WEB/workspace/"
  curl -sS -o /dev/null -w 'tenant %{http_code}\n' "$WEB/tenant-admin/"
  curl -sS -o /dev/null -w 'platform %{http_code}\n' "$WEB/platform-admin/"
  curl -sS -o /dev/null -w 'agent %{http_code}\n' "$WEB/agent-admin/"
  curl -sS -o /dev/null -w 'agent-me %{http_code}\n' "$WEB/api/agent-admin/v1/auth/me"

期望：四个页面 200；匿名 agent-me 为 401。登录、CSRF、登记 POST 由交付在本机用预览种子做，你不要把口令写进命令、日志或回复。现网 curl 只在部署负责人给出只读许可时做，并且只打状态码。

【现网】
你不 SSH、不改 DNS、不改 Nginx、不改 env、不重启服务。切换步骤与回滚句已经写在执行单①，原样保留。回滚句是：若这次发布后入口或新静态包异常，部署负责人把 /opt/mengine/current 指回切换前记下的 release，对 /etc/nginx/mengine.conf 做语法检查后重载专用 mengine-web；这次发布之后新写入的业务数据不回滚数据库。

【不许碰】
apps/api、engine、src、contracts、workers、.github/workflows、scripts/deploy/nginx-ai.conf.example、.local、口令、证书、env 文件内容。
禁止 git commit、push、gh、force push、reset --hard、直推 main。
禁止假 201、假已上架、假已开通。保存登记按钮若仍是灰的，记【待合】的点击落库，不要改按钮。

【做完输出】
1. 一张勾选表（照①的编号）；
2. preview-health 与五条 curl 的状态码；
3. 仍为【待合】的行及缺的编号（CT-039 实现 / CT-040 / CT-036 完整消费 / 页面保存按钮）；
4. 交给发布验收的截图清单：S-D1 S-D2 S-D3（1440×900），S-M1 S-M2（宽 390）。
```

## ④ 推荐模型与思考强度

- 模型：`gpt-6.1-sol`（或本机已有的 `gpt-5.3-codex`）
- 思考强度：**medium**。本单是清单、状态码和记录，没有 Java 设计。强度拉高时容易去改按钮或补读口，那是别的 CT。

## ⑤ 预计耗时

- Codex 按③填表：约 20–40 分钟（预览已在跑的前提下）。
- 发布验收截 5 张图并目检 390：约 30–45 分钟。
- 现网切换不进这个耗时，由部署负责人在 D10 的维护窗口做。

## ⑥ 跑完如何提交

仓内没有代码 diff 时**不开实现 PR**。勾选结果交给发布验收：PR 评论、或 Notion 两周页，附预览 SHA、五条状态码、【待合】清单、截图目录路径。目录留在 `~/Desktop/.smoke-qa-ct037-<日期>/`。

若交付要把文字记录入库（仍无截图、无口令）：

```bash
cd "$HOME/Desktop/mengine-app-luofanghao9784"
git remote get-url origin | grep -q 'luofanghao9784/mengine-app' || exit 1
git add docs/codex-tasks/CT-037-prod-mount-desktop-mobile-smoke.md
# 仅当另写了冒烟记录：
# git add docs/codex-tasks/<当次记录>.md
git diff --cached --stat | grep -E 'apps/api|engine/|src/|contracts/|\.github/workflows' && echo 'ERROR: 禁区' && exit 1
git commit -m "$(cat <<'EOM'
docs(codex-tasks): CT-037 现网挂载与桌面手机冒烟记录

只记录勾选与状态码。不含口令、env、截图原件。
EOM
)"
git push -u origin codex/ct-037-prod-mount-desktop-mobile-smoke
gh pr create -R luofanghao9784/mengine-app --base main --head codex/ct-037-prod-mount-desktop-mobile-smoke \
  --title "docs(codex-tasks): CT-037 现网挂载与冒烟清单" \
  --body "## 摘要
M4 / D9～D14 交付清单：现网挂载核对、预览到现网的切换步骤、一句回滚、桌面 M1～M3、手机 390。

## 审查
- 两人审：发布验收 + 质量性能
- 架构逻辑可选；若 diff 含 Java/契约/迁移则打回
- 截图人：发布验收（S-D1～S-D3，S-M1～S-M2）
- 勿自动合并

## 依赖
- 已合：CT-034-A #30、CT-035 #21、CT-034-P1 #22
- 【待合】：CT-039 实现、CT-040、CT-036 完整消费

## 非范围
自托管、全面抛光、批量运营、生产写入（部署负责人另行执行）"
```

网页备用：https://github.com/luofanghao9784/mengine-app/compare/main...codex/ct-037-prod-mount-desktop-mobile-smoke

合入本执行单文档 PR 的条件：CI 按纯文档门禁；非作者 `luofanghao1203` Approve（暂挂时该号 Comment「放行/可合」）；机审用 [`CODEX-REVIEW-PROMPT.md`](CODEX-REVIEW-PROMPT.md)。这不代替 D14 的 M4 终签。

## ⑦ 失败 / 卡住

| 症状 | 动作 |
|---|---|
| 有暂停令 | 停。不开 Codex，不碰现网 |
| remote 不是 luofanghao9784/mengine-app | 停，换正确仓 |
| main 不含 `75ab17a` | 停，先 pull |
| 预览未就绪 | 先 `preview-start`，再 health。不要改端口去迁就脚本 |
| 匿名 `/api/agent-admin/v1/auth/me` 不是 401 | 记 FAIL，停下问 DQ。不要改安全链 |
| 「保存登记」被点出成功 toast，但没有 201 | 打回。假成功 |
| 想把灰钮改成可点，或去实现 opened-capabilities | 停。那是别的 CT，本单保持【待合】 |
| 现网 IP、证书、`/agent-admin/` 反代与对照记录不符 | 只记差异，交给部署负责人。不自行改 DNS / Nginx |
| 备份失败仍要切换 | 禁止切换 |
| CONFLICT 或 push rejected | `git pull --rebase` 一次；仍失败就把原文发给 DQ，停下 |

**硬禁止**：

- `git push --force` / `-f` / `--force-with-lease`、`git reset --hard`、直推 `main`
- 除部署负责人以外的任何人改生产、改 DNS、重载 Nginx、改 env
- 把口令、Cookie、证书、env 内容写进仓库、PR、聊天
- 用客户资料做写通；用 `nginx-ai.conf.example` 当现网配置
- 自托管、全面抛光、批量开通
- 把【待合】勾成通过，或在 CT-040 未合时编造它的验收句

未合入的执行分支可删：`git switch main && git branch -D codex/ct-037-prod-mount-desktop-mobile-smoke`。已经切到现网的版本只走①的回滚句，不靠删分支回滚。
