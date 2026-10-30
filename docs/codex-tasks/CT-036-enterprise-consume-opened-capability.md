# CT-036 企业侧 / 工作台消费已开通能力

状态：骨架完整 · 可开跑扩展 · **实现细节随 CT-035 / CT-034-P1 合入后补裁**　｜　**正式岗（前端片）** id=`ec838a2d-d838-48cd-a789-e1af1424a7f3`　｜　分支：`codex/ct-036-enterprise-consume-opened`　｜　**审查人（实现 PR 后）：发布验收 + 质量性能**（门闸 / ADR-B8 加 **架构逻辑**；租户隔离加 **安全审查**）　｜　基准：切单时最新 `origin/main`（本骨架对照 `e339056`；须能叠上 CT-035 登录，以及 CT-034 写通后续的授权读模型）

> **日切片：D6～D8（11-05～11-07）/ 可演示点**：已开通企业在 tenant-admin 看见「已开通」；workspace 点进「质量检查」并走完最小路径（允许简陋）。未开通企业看不到、直链打不开。  
> **挂靠**：两周日切片 D6～D8 · 轨 A/B；[`两周日切片-三轨并行-20261031.md`](两周日切片-三轨并行-20261031.md)；验收句 **E1–E4**（[两周主路径验收句](https://www.notion.so/40966c386fbf81ad97cff544bc2906ff)）。E2 钉死 workspace「质量检查」，**本单不是「只保质量检查单功能」**，也不把 M1～M4 裁成这一页。  
> **总负责人不代跑**；老板 / 后端岗 / 正式前端岗在 Mac 自跑 Codex。Codex 尽量用。同一执行单、同一分支、一个实现 PR；D6 只读可见与 D8 可点进可以分两次提交，不另开编号。

规格依据：

- ADR-B8 D8-4 / **R-B8-2**：`docs/architecture/backend-v0/ADR-B8-第四端边界-统一agent管理平台.md`（qualityops 只经 `CapabilityCatalogPort`，不依赖 `agentregistry`）
- 契约骨架：`contracts/public-api/capability-registry.openapi.json`、`contracts/public-api/check-flow-config.openapi.json`、`contracts/public-api/error.schema.json`（骨架 ≠ 已实现）
- 人话：[《全端文案规范》](https://www.notion.so/40966c386fbf8120aaefc0290f9dedb8)、[去黑话对照](https://app.notion.com/p/40966c386fbf81f3a2e3e1822ae6a9b9)、[CT-035/036 人话验收句](https://www.notion.so/40966c386fbf811a8a68f00cb5ac8a77)（E36-1～E36-5 对照 E1–E4；**E36-6** 总部开通可复验，见⑥）
- 已合薄片：CT-034 `#14` / `c88699d` 仅 `POST /api/agent-admin/v1/capabilities` → **501**（`CapabilityRegistryController`）。这不是「本租户已开通」列表。

> **脚注（补裁）**：下面凡标 **【待补】** 的路径、字段、cookie、hash、演示包文件名，在 CT-035 与 CT-034-P1 合入后改成钉死句再跑最稳。未合入时允许按本骨架开跑，但不得把【待补】填成臆造接口或假已开通。  
> **脚注（包名现状）**：登记 stub 今日在 `com.dreamcore.workspace.agentadmin`；ADR 目标包名是 `agentregistry`。`qualityops` 与 `CapabilityCatalogPort` 都尚未落盘。R-B8-2 按意图执行：消费侧不 import `agentregistry`，也不 import `agentadmin`。

### 架构已裁（骨架 · 2026-10-30；DQ 可覆。实现细节待补裁）

1. **消费，不重做开通写。** 第四端把功能授权给企业的写路径留在 `agentregistry`（今日代码包名 `agentadmin`）。本单只在 **tenant-admin / workspace** 消费「本租户已开通」。
2. **读侧**只经 `capability.registry.CapabilityCatalogPort`，或**已经存在**的只读 API。服务端门闸放在 `qualityops` 或既有门闸。**禁止** `qualityops` 直依赖 `agentregistry`（ADR-B8 **R-B8-2**）。禁止 SQL 直读 `qo_capability` / `qo_module_version` / `qo_capability_tenant_grant` / `qo_admission_test_record`。
3. **可见性**：未开通该功能的企业看不到、直链打不开（E3）。已开通的企业可以点进去，页面允许简陋（D8）。
4. **E2 钉死** workspace 演示路径为「质量检查」（进入 → 提交一份检查材料或约定演示包 → 处理结果，或诚实空态/进度）。tenant 列出的是本租户**已开通的 AI 功能**，质量检查是必走的一条，不是把产品收成只有这一个功能。
5. **非范围**：开通页精致可写、批量运营、四端全面抛光、自托管（CT-033）。版本/开通页保持只读或灰钮即可。
6. **依赖**：CT-035 正式登录 + 租户隔离；CT-034 写通的后续片 **CT-034-P1** = 授权读模型，至少能只读「本租户已开通」。缺这两片时，本单停在接线位 + 诚实空态，不假造列表。
7. **人话**：可见文案用「质量检查」「已开通」「企业」。灰钮与总部同文：「暂时不能…（后台开通中）」。禁止界面裸写 `seed` / `capability` / `Grant` / `admission`。

**补裁清单**（依赖合入后改③再跑；未改前保持标记）：

| 标记 | 待钉死 | 现在知道的边界 |
|---|---|---|
| 【待补-读口】 | 本租户已开通列表的 path、operationId、字段 | 不要用第四端 `GET /api/agent-admin/v1/tenants/{tenantId}/grants` 当企业登录后的读口。`GET /api/tenant-admin/v1/quality-ops/bindable-modules` 只是「可绑定版本」骨架，未实现，不能当成已开通列表 |
| 【待补-会话】 | CT-035 的 cookie、realm、未登录状态码与人话 | 未合入前：未登录不得展示任何企业的已开通数据 |
| 【待补-演示包】 | workspace hash；检查材料或演示包路径/文件名 | 现壳没有「质量检查」页。禁止复用旧 `admin/governance` 页 id |
| 【待补-落点】 | 门闸二选一 | A. `qualityops` 只调用 `CapabilityCatalogPort`；B. 走既有 tenant/workspace 只读 API。两边都没有则诚实空态 |

## ① 目标与范围

- **目标**：企业侧和工作台用上「已开通」。企业负责人在 tenant-admin 看到已开通入口（E1）；员工在 workspace 走进「质量检查」最小路径（E2）；未开通企业看不到（E3）；不能做的步骤灰钮 + 人话（E4）。
- **增量边界（只做这些）**：
  1. tenant-admin：在**现有壳**上显示本租户已开通的 AI 功能；人话名，至少能认出「质量检查」。风格/动效跟随该现页；没有对应页时仿 tenant-admin，不另起皮肤。
  2. workspace：最小路径三步——进入「质量检查」→ 提交一份检查材料（或【待补-演示包】）→ 看到处理结果，或诚实空态/进度。禁止假「检查通过」。
  3. 后端：消费侧只读门闸。`qualityops` 若新建，包根 `com.dreamcore.workspace.qualityops`，只依赖 capability 端口；端口未落盘则不要为了演示去 new 一个写侧客户端。
  4. 未开通与跨租户：入口隐藏或直链拒绝；错误 JSON 带人话 `message`；响应里不出现其他企业的名称、名单、材料。
  5. 测试：至少覆盖「已开通可见或诚实空态」与「未开通不可见」；若动了 Java，再加一条「消费包不依赖 agentregistry / agentadmin」。
- **改哪些文件（允许）**：
  - `tenant-admin/**`、`workspace/**`、`src/**` 里企业端/工作台消费「已开通」与「质量检查」最小页（勿改 agent-admin 人话，那是 CT-038）
  - `apps/api/src/main/java/com/dreamcore/workspace/qualityops/**` 或既有只读门闸的最小扩展；对应测试
  - 不新造授权写；不改 `CapabilityRegistryStubSecurity` 去落库
- **不做什么（非范围）**：
  - 精致开通页、批量给多家企业开通、四端全面抛光、自托管 runner
  - 第四端授权写、上架/开通状态机、登录签发（CT-035）、登记 POST 从 501 改成假 201（CT-034）
  - 真实模型检查、parser、engine 业务大改
  - 把两周主路径收成「只有质量检查这一项功能」
  - 改 `com.dreamcore.*` 包名字符串、`/mengine-api`、`MENGINE_*`

## ② 前置条件与分支名

- **⓪ 暂停令自查（第一步，优先级最高）**：有或拿不准 → **立刻停**，问 DQ。
- **依赖**：
  - CT-035 登录与租户隔离（未合入 → 【待补-会话】保持，未登录 fail closed）
  - CT-034-P1 授权读模型，至少只读「本租户已开通」（未合入 → 【待补-读口】保持；CT-034 `#14` 的 501 stub **不算**这个读模型）
  - 人话口径沿用 CT-038 已合补丁词；本单不回头改 agent-admin
- 正确仓：`~/Desktop/mengine-app-luofanghao9784`（origin=`luofanghao9784/mengine-app`）。
- 实现分支：`codex/ct-036-enterprise-consume-opened`。
- 预览约定：web `50832`，api `50831`（以 `preview-health` / 启动输出为准）。

```bash
# ⓪ 暂停令自查：无暂停令再继续
CODEX="/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex"
REPO="$HOME/Desktop/mengine-app-luofanghao9784"
cd "$REPO"
git remote get-url origin | grep -q 'luofanghao9784/mengine-app' || { echo 'ERROR: 错误 remote，停'; exit 1; }
git status
git switch main && git pull
export JAVA_HOME="$(/usr/libexec/java_home -v 21)"
export POSTGRES_BIN="$(brew --prefix postgresql@18)/bin"
git switch -c codex/ct-036-enterprise-consume-opened
```

开跑前看一眼依赖在不在。没有也不要自己编：

```bash
# CT-035：登录实现。没有则【待补-会话】
git log origin/main --oneline --grep=CT-035 -n 5
# CT-034-P1：授权读模型。#14 只有 POST 501，不算读模型
git log origin/main --oneline --grep=CT-034 -n 5
```

## ③ 提示词骨架

把下面整段交给 Codex（模型 `gpt-6.1-sol`，思考强度 **high**）。方括号【待补】原样保留，除非依赖 PR 已经合入并且你能从该 PR 抄到钉死值。

```
你在梦擎仓库分支 codex/ct-036-enterprise-consume-opened 上工作。基准 origin/main。只做本单范围。执行单：docs/codex-tasks/CT-036-enterprise-consume-opened-capability.md。
两周挂靠：docs/codex-tasks/两周日切片-三轨并行-20261031.md（D6～D8 · E1–E4）。
验收句 E1–E4：https://www.notion.so/40966c386fbf81ad97cff544bc2906ff
人话句 E36：https://www.notion.so/40966c386fbf811a8a68f00cb5ac8a77
ADR-B8 D8-4 / R-B8-2：docs/architecture/backend-v0/ADR-B8-第四端边界-统一agent管理平台.md
文案：https://www.notion.so/40966c386fbf8120aaefc0290f9dedb8 与 https://app.notion.com/p/40966c386fbf81f3a2e3e1822ae6a9b9

【强制口径】
1. 本单是企业侧/工作台消费「已开通」。第四端授权写留在 agentregistry（今日代码在 com.dreamcore.workspace.agentadmin）。不要新做开通写，不要改 CapabilityRegistryStubSecurity 去落库，不要把 CT-034 的 501 改成 201。
2. 读侧只经 CapabilityCatalogPort，或已经存在的只读 API。禁止 qualityops 依赖 agentregistry，也禁止 import agentadmin（R-B8-2 的意图）。禁止 SQL 直读 qo_capability、qo_module_version、qo_capability_tenant_grant、qo_admission_test_record。
3. 未开通该功能的企业看不到、直链打不开，响应不泄露其他企业数据（E3）。已开通的可以点进，页面允许简陋。
4. E2 钉死 workspace 演示路径是「质量检查」。这不是「只保质量检查单功能」：tenant 显示本租户已开通的功能（质量检查必须能走进）；不要删掉其他已开通入口，也不要把两周主路径裁成这一页。
5. 禁止假已开通、假 Live、假成功。读不到真列表时用诚实空态或灰钮，文案带「暂时不能…（后台开通中）」。
6. 界面人话用「质量检查」「已开通」「企业」。禁止裸写 seed / capability / Capability / Grant / admission。
7. 不改 com.dreamcore 包名字符串、/mengine-api、MENGINE_*。远程只许 luofanghao9784/mengine-app。
8. 【待补】项：依赖没合入就不要发明 path、cookie、hash、演示包文件名。缺读模型时只留接线位 + 诚实空态，PR 正文列出仍未补裁的标记。

【待补 · 原样保留，除非已从合入的 CT-035 / CT-034-P1 抄到钉死值】
- 【待补-读口】本租户已开通列表的 HTTP path、operationId、响应字段。候选不是裁定：GET /api/tenant-admin/v1/quality-ops/bindable-modules（listBindableModulesForTenant）是「可绑定版本」骨架且未实现；GET /api/agent-admin/v1/tenants/{tenantId}/grants 是第四端表面，企业登录后的消费读口不要用它，更不要做它的 POST。CT-034 #14 只有 POST /api/agent-admin/v1/capabilities 的 501。
- 【待补-会话】CT-035 合入后的企业负责人/员工 cookie、realm、未登录状态码和人话 message。未合入前未登录不得展示已开通数据。
- 【待补-演示包】workspace「质量检查」hash。现壳没有此页；禁止复用 admin/governance 页 id。检查材料或约定演示包的路径/文件名等产品钉死后再写死。最小三步不变：进入 → 提交一份材料 → 结果或诚实空态/进度。
- 【待补-落点】二选一，写进 PR：A) qualityops 只调用 CapabilityCatalogPort（端口由 agentregistry.adapter 实现，qualityops 不 import 写侧包）；B) 前端走已经存在的 tenant/workspace 只读 API，服务端同样不直依赖 agentregistry/agentadmin。两边都没有就诚实空态，不要 SQL 登记表，不要新造授权写。

【A. tenant 看见已开通 · E1】
1. 在既有 tenant-admin 壳上显示已开通入口。已有页可改功能，风格/动效/交互跟随该现页；无页则仿 tenant-admin。前端正式岗 id=ec838a2d-d838-48cd-a789-e1af1424a7f3。
2. 已开通演示企业的企业负责人登录后，能看到人话名「质量检查」，不是裸 key quality-check。读口仍是【待补-读口】时：不要填假列表；空态写「暂时不能查看已开通功能（后台开通中）」。
3. PR 写可点 URL。约定 http://127.0.0.1:50832/tenant-admin/ （端口以预览实测为准）。hash 与【待补-演示包】一起补。

【B. workspace 走进质量检查 · E2 / E4】
1. 最小路径：进入「质量检查」→ 提交一份检查材料（或【待补-演示包】）→ 处理结果，或诚实空态/进度。禁止假「检查通过」。
2. 能做的给主按钮；不能做的 disabled，title 与旁注「暂时不能…（后台开通中）」。
3. 本单不跑真实模型、不改 parser、不改 engine 业务。
4. PR 写可点 URL。约定 http://127.0.0.1:50832/workspace/ 加【待补 hash】。

【C. 未开通看不到 · E3】
1. 未开通该功能的企业：tenant-admin 与 workspace 都看不到或打不开「质量检查」。
2. 直链失败，人话错误，不返回其他企业的名称、名单或材料。
3. 租户只从登录上下文来，不信任前端自报的 tenantId。

【D. 后端门闸】
1. 只读。新 Java 放 qualityops 或既有门闸，包名保持 com.dreamcore.*。
2. 依赖方向只允许 qualityops → capability 端口。出现对 agentregistry 或 agentadmin 的 import 即本单失败。
3. 不实现登录签发，不实现「开通给企业」写接口。

【不许碰】
agent-admin 人话与授权写、开通页精致化、批量运营、全面抛光、自托管、engine/** 业务、workers/parser、dist/** 手改、.local/**、口令、force push、reset --hard、直推 main、gh issue。
禁止改包名、/mengine-api、MENGINE_*。禁止复用 governance 页 id。

【做完输出】
git diff --stat；实际读口或仍为【待补-读口】；tenant 与 workspace 的可点 URL；已开通账号看见什么、未开通账号看见什么；qualityops/消费代码是否 import 了 agentregistry 或 agentadmin（必须否）；仍待补裁清单。
```

## ④ 推荐模型与思考强度

- 模型：`gpt-6.1-sol`
- 思考强度：**high**（读侧端口、租户隔离和「不许假已开通」要同时守住）
- **预计耗时**：Codex 60–120 分钟；预览点开 tenant + workspace 20–40 分钟。Java 门闸若新增测试，再加一次性 Postgres 跑本单相关测试的时间。

## ⑤ 可复制 git 步骤（跑完如何提交）

```bash
CODEX="/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex"
REPO="$HOME/Desktop/mengine-app-luofanghao9784"
cd "$REPO"
git remote get-url origin | grep -q 'luofanghao9784/mengine-app' || exit 1
# 按实际改动暂存。勿 add 口令 / .local / dist
git add tenant-admin workspace src apps/api/src/main/java/com/dreamcore/workspace/qualityops apps/api/src/test
git diff --cached --stat | grep -E 'workers/parser|engine/|agentadmin/CapabilityRegistryStubSecurity' && echo 'ERROR: parser/engine/登记 stub 非本单' && exit 1
git commit -m "$(cat <<'EOM'
feat(tenant): CT-036 企业侧消费已开通能力

tenant 见已开通；workspace 走进质量检查最小路径。
读侧经目录端口或既有只读 API；qualityops 不依赖 agentregistry。
EOM
)"
git push -u origin codex/ct-036-enterprise-consume-opened
gh pr create -R luofanghao9784/mengine-app --base main --head codex/ct-036-enterprise-consume-opened \
  --title "feat(tenant): CT-036 企业侧接通已开通能力" \
  --body "## 摘要
企业侧消费已开通：tenant-admin 可见；workspace 走进「质量检查」最小路径。未开通企业不可见。

## 可点开
- tenant：http://127.0.0.1:50832/tenant-admin/ （hash 以实测为准）
- workspace：http://127.0.0.1:50832/workspace/ （质量检查 hash 以实测为准）
端口以预览为准。读口若仍是执行单里的【待补】，正文写明，并确认界面是诚实空态而不是假列表。

## 审查
- 发布验收 + 质量性能；门闸/ADR-B8 加架构逻辑；租户隔离加安全审查
- 挂靠两周日切片 D6～D8 / 验收句 E1–E4
- 勿自动合并

## 非范围
精致开通页、批量运营、全面抛光、自托管、登录签发（CT-035）、授权写（agentregistry）"
```

网页备用：https://github.com/luofanghao9784/mengine-app/compare/main...codex/ct-036-enterprise-consume-opened

若当日只动了前端或只动了 Java，提交说明里的 `feat(tenant)` 可改成实际范围，正文仍须写清 E1–E4 哪些已可点、哪些停在诚实空态。

## ⑥ 验收标准

日可演示（web 约定 `50832`，api 约定 `50831`，以预览实测为准）。下表是 E 方向；读口或演示包仍是【待补】时，E1/E2 用诚实空态验收，不得用假列表顶上。

| # | 方向 | 标准 | 如何验 |
|---|---|---|---|
| E1 | tenant 看见已开通 | 企业负责人在 tenant-admin 看到总部已开通的 AI 功能入口，人话名（「质量检查」），不是英文 key | 已开通演示企业登录后入口可见。读口未合入时，空态须写「暂时不能查看已开通功能（后台开通中）」，不能是假名单 |
| E2 | workspace 最小路径 | 员工打开已开通的「质量检查」：进入 → 提交一份检查材料（或【待补-演示包】）→ 处理结果，或诚实空态/进度。禁止假 Live | 点进 workspace 该页并走完三步。本条钉死演示路径，不表示产品只保留质量检查 |
| E3 | 未开通不可见 | 未开通该功能的企业看不到或打不开；租户隔离可演示 | 对照企业登录后无入口；直链被拒，响应无其他企业的名称、名单或材料 |
| E4 | 空态与灰钮诚实 | 能做给主按钮；不能做则灰钮 +「暂时不能…（后台开通中）」 | 与总部灰钮文案抽检一致；没有假成功 toast |
| E36-6 | 总部开通可复验 | 总部「企业开通」能查到该企业已开通，且与企业侧所见一致。可挂 CT-034-P1 / grants **只读**对账。禁止两边名单打架 | 对照总部「企业开通」只读结果与 tenant / workspace 所见；不一致即不过。读模型未合入时两边都停在诚实空态，不得一边填假名单 |

架构抽查（不替代上表）：消费代码无 `agentregistry` / `agentadmin` import；没有对登记表 / 授权表的 SQL。E36-6 的对账只读 grants 或 CT-034-P1 读模型，不在本单写授权。

## ⑦ 禁止操作 / 失败卡住

| 症状 | 动作 |
|---|---|
| remote 不是 mengine-app | 立刻停 |
| 有暂停令 | 不开 Codex；问 DQ |
| 把【待补-读口】写成了新的 grants POST，或企业端去调第四端授权写 | **打回**；读侧改端口或既有只读 API |
| qualityops（或本单新消费类）import 了 agentregistry 或 agentadmin | **打回**；改经 `CapabilityCatalogPort` 或既有只读 API（R-B8-2） |
| 未开通企业仍能看到入口或他企数据 | **打回**；fail closed |
| 界面出现假已开通列表、假「检查通过」 | **打回**；改诚实空态/进度 |
| 只做了质量检查页，并删掉或藏起其他已开通入口 | **打回**；E2 是演示路径，不是单功能裁剪 |
| 误改登记 stub、包名、`/mengine-api`、parser、engine | `git restore`；报 DQ |
| CONFLICT / push rejected | `git pull --rebase` 一次；仍失败停发 DQ |

**硬禁止**：

- `git push --force` / `-f` / `--force-with-lease`、`git reset --hard`、直推 `main`
- 假已开通、假 Live、无落库却返回成功
- `qualityops` 直依赖 `agentregistry`（以及今日的 `agentadmin` 写侧）
- SQL 直读登记表 / 授权表来绕过端口
- 精致开通页、批量运营、全面抛光、自托管
- 在本单实现登录签发或「开通给企业」写接口
- 把两周验收收成「只保质量检查」
- 改 `com.dreamcore.*` 包名、`/mengine-api`、`MENGINE_*`
- `gh issue create/comment`；含口令提交
- 有暂停令仍开 Codex

回滚（未合入）：`git switch main && git branch -D codex/ct-036-enterprise-consume-opened`。

---

**DQ 审路径**：本文件 + 两周日切片 D6～D8 + 验收句 E1–E4、E36-6。通过后交老板 / 后端岗 / 前端岗 Mac 粘贴③开跑。CT-035 与 CT-034-P1 合入后，先把【待补】改成钉死句再跑完整 E1/E2；未合入时只允许诚实空态扩展，不允许假已开通。

## 附录 · 【待补-演示包】

产品稍后钉文件名/路径。
