# CT-035 正式登录 + 租户隔离

状态：架构已裁可跑 · 待 docs 入库后交老板 Mac Codex　｜　分支：`codex/ct-035-agent-admin-login-tenant-isolation`　｜　**审查人（实现 PR 后）：架构逻辑 + 安全审查 + 质量性能**　｜　基准：切单时最新 `origin/main`（本单对照 `6502ac6`，含 CT-036 `#18`；开跑前再 `git pull`）

> **本单只钉一件事：正式登录 + 租户隔离**（终签 **L1–L4**）。  
> **realm / cookie：【待补】**，可以标，不要在本执行单里冻成唯一真值。  
> **与 agent-admin 写口无关。** 不改登记 POST、不改 Capability OpenAPI、不碰 `CapabilityRegistryStubSecurity`、不把 CT-034 的 501 改成 401 或 201。  
> **日切片：2026-11-03～11-04（D4～D5）/ 可演示点**：四端可登；错账密人话；登出干净；A 企业看不到 B 企业的数据。  
> **挂靠**：[`两周日切片-三轨并行-20261031.md`](两周日切片-三轨并行-20261031.md) D4～D5·轨 A。CT-036 的【待补-会话】等本单行为合入后再抄，不要提前把 realm/cookie 填进 CT-036。  
> **总负责人不代跑**；老板/后端岗在 Mac 自跑 Codex。Codex 尽量用。  
> **非范围**：CT-038 人话、CT-036 企业侧消费已开通、假 Live、**agent-admin 写口**。

规格依据：

- 终签 L1–L4：[两周主路径验收句](https://www.notion.so/40966c386fbf81ad97cff544bc2906ff)
- 人话 L35-1～L35-5、L35-7：[CT-035/036 人话验收句](https://www.notion.so/40966c386fbf811a8a68f00cb5ac8a77)（L35-6 写前登录墙、L35-8 未开通入口归 **CT-036**，本单不验写口）
- ADR-B8 D8-2 / D8-3：`docs/architecture/backend-v0/ADR-B8-第四端边界-统一agent管理平台.md`（会话方向；**cookie 名与 realm 字符串仍标【待补】**）
- 已合写口勿碰：CT-034 `#14` / `c88699d` 的 `POST /api/agent-admin/v1/capabilities` → 501
- 错误形状：`contracts/public-api/error.schema.json`

> **脚注（【待补】）**：下表 realm、cookie 名、Path、过滤链落点在安全审查钉死前保持标记。实现可以用 ADR-B8 D8-2 的候选，但 PR 正文必须仍标【待补-realm】【待补-cookie】，并写明「安全审查可覆」。未覆之前，别的单（含 CT-036）不得把这两个字符串当成已冻结契约。  
> **脚注（写口）**：本单不读、不改 agent-admin 的登记/上架/开通写路径。未登录能否 POST 能力、未知字段是否 400、`enterpriseFunction` 闭集，都不是本单。

### 架构已裁（2026-10-31；DQ 可覆）

1. **钉死范围：正式登录 + 租户隔离。** 平台账号能进总台；企业负责人能进企业管理后台；员工能进工作台；错账密与无权限是短人话；登出后再登看不到上一账号的企业名、菜单、列表；A 企业会话看不到 B 企业的成员或数据。
2. **【待补-realm】【待补-cookie】可标，本单不冻字符串。** ADR-B8 D8-2 候选（不是本单验收等式）：第四端 `realm='agent'`、cookie 名 `DREAMCORE_AGENT`、Path `/api/agent-admin/`、独立 `SecurityFilterChain`、不挂客户 `IdentitySecurity`、跨域会话 401、独立会话表、角色 `AGENT_ADMIN` 与 `PLATFORM_ADMIN` 互不包含。候选可以拿去实现，验收先看隔离行为，不把候选字符串写成「少一个字即失败」。
3. **与 agent-admin 写口无关。** 禁止改 `POST /api/agent-admin/v1/capabilities` 及同资源的登记/上架/开通写；禁止改 `contracts/public-api/capability-registry.openapi.json` 的 `Capability`（含 `enterpriseFunction`、`additionalProperties`、400）；禁止改 `CapabilityRegistryStubSecurity`；禁止把 501 stub 改成 401、201 或假成功。
4. **人话（登录，已钉）**：错账密 `message` 全等「账号或密码不对，请再试一次」。无权限「这个账号没有这里的权限」，并给换账号或去对应入口。不白屏、不甩堆栈、错误体不带别的企业的名称或数据。
5. **租户隔离（已钉）**：客户会话只带本企业。跨企业读失败或为空，且对人话诚实。第四端若本单顺手接上登录，会话里仍然没有租户、不构造 `ExecutionScope`。未开通功能的企业侧入口归 CT-036，本单不造假「已开通」列表。
6. **非范围**：CT-038 导航/分区/按钮与 hash；CT-036 的 tenant-admin / workspace 消费页与质量检查提交；假 Live。

**补裁清单**（安全审查钉死后改③再跑；未改前保持标记）：

| 标记 | 待钉死 | 现在只允许当候选 |
|---|---|---|
| 【待补-realm】 | 第四端 `SessionProvider` 的 realm 字符串，以及与 customer / platform 的分支 | ADR 候选 `agent`。不要发明第四个产品名，也不要写进 CT-036 |
| 【待补-cookie】 | cookie 名、Path、是否独立 `SecurityFilterChain`、与客户 `IdentitySecurity` 的边界、跨域状态码所绑的 cookie 名 | ADR 候选名 `DREAMCORE_AGENT`，Path `/api/agent-admin/`，独立链，跨域失败。字符串未覆前不作唯一断言 |

## ① 目标与范围

- **目标**：正式登录 + 租户隔离达到 L1–L4。各端会话不能串；错账密是钉死人话；登出干净；A 看不到 B。
- **增量边界（只做这些）**：
  1. 登录 / 登出 / 当前身份：平台总台、企业管理后台、员工工作台三端现有登录保持可登，并补上「串会话即失败」的测试。第四端登录只在不碰写口的前提下接线；realm 与 cookie 用候选并标【待补】。
  2. 错账密、无权限：人话 JSON（`message` 必填），无堆栈。
  3. 登出只清本端会话；再登另一账号时，接口与页面都没有上一账号的企业名和列表。
  4. 租户隔离：两个合成企业。A 的身份与名单不含 B。
  5. 测试覆盖 L1–L4 的行为。断言隔离与人话，**不要**把【待补-realm】【待补-cookie】的候选字符串写成唯一通过条件；PR 列出实际采用的候选。
- **改哪些文件（允许）**：
  - `apps/api/src/main/java/com/dreamcore/**` 里身份、会话、过滤链（**禁止改包名**）
  - `apps/api/src/test/java/com/dreamcore/**`
  - 若确需新表：只新增 `apps/api/src/main/resources/db/migration-common/` 迁移（三处目录最大版本 + 1；不改已有文件，不改 V55）
  - 登录墙所必需的 `src/identity/session.tsx`、`src/identity/main.tsx`（不改 CT-038 已合文案与 hash）
- **不做什么（非范围）**：
  - **agent-admin 写口**：`CapabilityRegistryController`、`CapabilityRegistryStubSecurity`、`POST /api/agent-admin/v1/capabilities`、capability-registry OpenAPI、`enterpriseFunction`、未知字段 400
  - CT-036 企业侧/工作台消费、质量检查提交、未开通入口 UI
  - CT-038 人话与路由键；假 Live；无落库 201
  - `/mengine-api`、`MENGINE_*`、Java 包名；远程只许 `luofanghao9784/mengine-app`

## ② 前置条件与分支名

- **⓪ 暂停令自查（第一步）**：有或拿不准 → **立刻停**，问 DQ。
- 正确仓：`~/Desktop/mengine-app-luofanghao9784`（origin=`luofanghao9784/mengine-app`）。
- 依赖：main 已含 CT-034 写口 501 stub 与 CT-036 骨架。本单**不修改**这两处的写口与消费页。
- 实现分支：`codex/ct-035-agent-admin-login-tenant-isolation`。

```bash
CODEX="/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex"
REPO="$HOME/Desktop/mengine-app-luofanghao9784"
cd "$REPO"
git remote get-url origin | grep -q 'luofanghao9784/mengine-app' || { echo 'ERROR: 错误 remote，停'; exit 1; }
git status
git switch main && git pull
export JAVA_HOME="$(/usr/libexec/java_home -v 21)"
export POSTGRES_BIN="$(brew --prefix postgresql@18)/bin"
git switch -c codex/ct-035-agent-admin-login-tenant-isolation
```

## ③ 完整 Codex 提示词

把下面整段交给 Codex（模型 `gpt-6.1-sol`，思考强度 **high**）。方括号【待补】原样保留。

```
你在梦擎仓库分支 codex/ct-035-agent-admin-login-tenant-isolation 上工作。基准 origin/main（须含 6502ac6 / CT-036 #18）。只做本单范围。执行单全文：docs/codex-tasks/CT-035-agent-admin-login-tenant-isolation.md。
终签 L1–L4：https://www.notion.so/40966c386fbf81ad97cff544bc2906ff
人话：https://www.notion.so/40966c386fbf811a8a68f00cb5ac8a77 （只用 L35-1～5 与 L35-7；L35-6 与 L35-8 不是本单）
ADR-B8 D8-2/D8-3：docs/architecture/backend-v0/ADR-B8-第四端边界-统一agent管理平台.md
错误形状：contracts/public-api/error.schema.json

【强制口径】
1. 本单钉死的只有：正式登录 + 租户隔离。L1 平台账号可登总台（第四端登录可接线，但见第 2 条）。L2 企业负责人登企业管理后台、员工登工作台，两端不串。L3 错账密 message 全等「账号或密码不对，请再试一次」；无权限「这个账号没有这里的权限」，可换账号或离开；不白屏、不甩堆栈。L4 登出后再登，看不到上一账号的企业名、菜单、列表。另：合成企业 A 的会话看不到 B 的成员或数据，错误体不泄露对方。
2. 【待补-realm】【待补-cookie】保持标记。ADR 候选（安全审查可覆，不是本单唯一断言）：realm=agent；cookie 名 DREAMCORE_AGENT；Path=/api/agent-admin/；独立 SecurityFilterChain；不挂客户 IdentitySecurity；跨域会话失败。实现若采用候选，PR 正文仍写【待补-realm】【待补-cookie】与实际字符串。不要发明候选以外的名字。不要把候选写进 CT-036。测试断言隔离行为（串 cookie / 串企业即失败），不要把 cookie 名写成唯一通过条件。
3. 与 agent-admin 写口无关。禁止改 POST /api/agent-admin/v1/capabilities、CapabilityRegistryController、CapabilityRegistryStubSecurity、contracts/public-api/capability-registry.openapi.json。禁止把 CT-034 的 501 改成 401、201 或任何成功。禁止补 enterpriseFunction、禁止为未知字段加 400。未登录写、登记落库、上架、开通都不是本单。
4. 人话只用登录这几句。不改 CT-038 已合的导航/分区/按钮，不改 hash。不做 CT-036 的已开通列表、质量检查提交、未开通入口。禁止假 Live、假已开通、无落库 201。
5. 不改 com.dreamcore 包名、/mengine-api、MENGINE_*。远程只许 luofanghao9784/mengine-app。口令不进 git。不构造 ExecutionScope 去代租户执行。

【A. 登录与隔离】
1. 总台、企业管理后台、工作台：现有登录仍可用。错账密与无权限走上面的人话。
2. 登出只清本端会话。再登另一个账号后，me 与页面都没有上一账号的企业数据。
3. 两个合成企业 A/B：A 的成员与名单接口不含 B。跨企业读失败或空，且人话诚实。
4. 第四端若接线登录：只用【待补】里的 ADR 候选，不新增 platform-admin 路径来冒充第四端，也不把第四端 matcher 塞进客户 IdentitySecurity。会话无租户。总部支持会话不得借此看到企业数据。
5. 需要新表时只新增 migration-common 迁移，照 V55 的独立表思路，不在旧会话表加 realm 列，不编辑 V55 文件。表名在 PR 写明，并标是否仍【待补】。

【B. 测试】
- 错账密 message 全等「账号或密码不对，请再试一次」。
- 登出后再取当前身份，不得带回上一账号企业名。
- A 看不到 B。
- 一端的会话不能当另一端的登录成功（行为失败即可；cookie 名字断言标【待补】）。
- 禁止 -DskipTests 掩盖本单。
- 不要加「未登录 POST 能力登记」或「未知字段 400」测试。那是写口。

【不许碰】
apps/api 里 CapabilityRegistry*、contracts/public-api/capability-registry.openapi.json、src/features/agent-admin 的登记/上架/开通写与 CT-038 文案、tenant-admin 与 workspace 的「已开通 / 质量检查」消费页、engine/**、workers/parser、dist/**、src/demo/、.local/**、口令、force push、reset --hard、直推 main、gh issue。

【本地验收（预览 web=50832、api=50831；以实测为准）】
- http://127.0.0.1:50832/platform-admin/ 可登；错账密见钉死文案。
- http://127.0.0.1:50832/tenant-admin/ 企业负责人可登；http://127.0.0.1:50832/workspace/ 员工可登；登出后再登无上一企业名。
- 用 A 的会话请求 B 的数据：失败或空，响应无 B 的企业名。
- 不要用 curl 改或断言 POST /api/agent-admin/v1/capabilities。

【做完输出】git diff --stat、实际 realm/cookie（并标【待补】）、L1–L4 怎么验的、跨租户结果、明确写「未改 agent-admin 写口」、SKIP（CT-036 / CT-038 / 写口）。
```

## ④ 推荐模型与思考强度

- 模型：`gpt-6.1-sol`
- 思考强度：**high**
- 本机没有该模型 id 时停，问 DQ，不要换模型。
- **预计耗时**：Codex 60–120 分钟；测试与四端点登 30–50 分钟

## ⑤ 可复制 git 步骤（跑完如何提交）

```bash
CODEX="/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex"
REPO="$HOME/Desktop/mengine-app-luofanghao9784"
cd "$REPO"
git remote get-url origin | grep -q 'luofanghao9784/mengine-app' || exit 1
git add apps/api/src/main apps/api/src/test src/identity/session.tsx src/identity/main.tsx
git diff --cached --stat | grep -E 'capability-registry.openapi|CapabilityRegistry|workers/parser|src/demo/' && echo 'ERROR: 写口或禁区' && exit 1
git commit -m "$(cat <<'EOM'
feat(identity): CT-035 正式登录与租户隔离

四端登录隔离、错账密人话、登出干净、跨企业不可见。
realm/cookie 仍标待补。不改 agent-admin 写口。
EOM
)"
git push -u origin codex/ct-035-agent-admin-login-tenant-isolation
gh pr create -R luofanghao9784/mengine-app --base main --head codex/ct-035-agent-admin-login-tenant-isolation \
  --title "feat(identity): CT-035 正式登录与租户隔离" \
  --body "## 摘要
正式登录 + 租户隔离（L1–L4）。realm / cookie 标【待补】。与 agent-admin 写口无关。

## 验收
- 错账密人话、登出干净、A 看不到 B
- diff 不含 capability-registry 与 CapabilityRegistry*

## 审查
- 架构逻辑 + 安全审查 + 质量性能
- 勿自动合并

## 非范围
agent-admin 写口、CT-036 消费已开通、CT-038 人话、假 Live"
```

网页备用：https://github.com/luofanghao9784/mengine-app/compare/main...codex/ct-035-agent-admin-login-tenant-isolation

## ⑥ 验收标准（L1–L4）

日可演示（Mac 预览；约定 web=`50832`、api=`50831`，以实测为准）。

| # | 标准 | 如何验 |
|---|---|---|
| L1 | 平台账号可登录 platform-admin 与（若本单接线）agent-admin | 总台登录成功并看到本平台页面。第四端是否接线以 PR 为准；接线时不得新开 platform-admin 登录路径冒充。realm / cookie 名只记录实际值并标【待补】，不作为本条唯一失败条件 |
| L2 | 企业负责人账号可登录 tenant-admin；员工账号可登录 workspace | 两端各自可登、互不串页。一端的会话拿到另一端应失败。失败所绑的 cookie 名标【待补-cookie】 |
| L3 | 错账密 / 无权限：短人话错误 + 可恢复动作；不白屏、不甩堆栈 | 错账密 `message` 全等「账号或密码不对，请再试一次」。无权限「这个账号没有这里的权限」，可换账号或离开。JSON 无堆栈、无其他企业数据。**不要**用能力登记 POST 的状态码充当本条 |
| L4 | 登出后再登：会话干净，看不到上一账号数据 | 登出后当前身份不再带回上一账号。再登另一账号，页面与接口无上一企业名、菜单、列表。合成企业 A 看不到 B 的成员或数据 |

本单相关测试绿。`git diff` 不得包含 `capability-registry.openapi.json` 与 `CapabilityRegistry*`。

## ⑦ 禁止操作 / 失败卡住

| 症状 | 动作 |
|---|---|
| remote 不是 mengine-app | 立刻停 |
| 有暂停令 | 不开 Codex；问 DQ |
| 模型不是 `gpt-6.1-sol` | 停，问 DQ |
| 改了 agent-admin 写口、OpenAPI Capability、StubSecurity，或把 501 改成 401/201 | **打回**；`git restore` 这些文件 |
| 把 realm/cookie 候选写成 CT-036 的冻结契约，或测试只认某一个 cookie 字符串 | 改测试为隔离行为；PR 保持【待补-realm】【待补-cookie】 |
| 错账密文案漂移 | 改回钉死句 |
| 登出后仍看见上一企业名，或 A 看见 B | 未完成 |
| 出现假 Live / 假已开通 | **打回** |
| 改了 CT-038 文案或做了 CT-036 消费页 | `git restore`；报 DQ |
| 测试红 | 修到绿；禁止 `-DskipTests` 掩盖本单 |
| CONFLICT / push rejected | `git pull --rebase` 一次；仍失败停发 DQ |

**硬禁止**：

- `git push --force` / `-f` / `--force-with-lease`、`git reset --hard`、直推 `main`
- 改 agent-admin 写口（登记 POST、Capability OpenAPI、`enterpriseFunction`、未知字段 400、StubSecurity、501→201/401）
- 假 Live、无落库 201、把【待补】填成臆造 cookie / realm
- CT-036 消费页、CT-038 人话重写
- 改 `com.dreamcore.*` 包名、`/mengine-api`、`MENGINE_*`；编辑 V55；提交口令
- `gh issue create/comment`；有暂停令仍开 Codex

回滚（未合入）：`git switch main && git branch -D codex/ct-035-agent-admin-login-tenant-isolation`。

---

**DQ 审路径**：本文件（钉正式登录 + 租户隔离；realm/cookie 标【待补】；与写口无关）+ 终签 L1–L4。通过后交老板/后端岗 Mac 粘贴③开跑。安全审查看隔离行为；cookie 名与 realm 字符串未覆前不要当成冻结契约。
