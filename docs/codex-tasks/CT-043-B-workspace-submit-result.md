# CT-043-B 工作台「质量检查」提交与结果接线

状态：架构已裁可跑 · 待 docs 入库后交老板 Mac Codex　｜　**正式岗** id=`ec838a2d-d838-48cd-a789-e1af1424a7f3`（勿派重复岗）　｜　分支：`codex/ct-043-b-workspace-submit-result`　｜　**审查人：发布验收 + 质量性能 + 架构逻辑 + 安全审查**　｜　基准：`b5c3ab8329b5826735e080b62d1ddff0a097b939`（[#46](https://github.com/luofanghao9784/mengine-app/pull/46)，含 `127efe6` / #45、#41 `348cafc4`）

> **日切片：D6～D8 / 可演示点**：`/workspace/#tenant=<企业ID>&view=quality-check`。未开通没有提交按钮，人话「贵企业还没开通「质量检查」，请联系平台管理员开通」。已开通后文本框可提交。只有 201 且合同字段齐全才显示人话结论。失败不显示任何结论。页面不出现「检查通过」。  
> **挂靠**：轨 B。契约与 [`CT-043-A-quality-check-submit-api.md`](CT-043-A-quality-check-submit-api.md)「契约钉死」逐条相同。**可按契约并行开发（mock）。A 先合，本单再合。** e2e 归本单。不单列 C。  
> 模型 `gpt-6.1-sol`，思考强度 **high**（本机 `gpt-5.1-codex` 亦可）。仓 `luofanghao9784/mengine-app`。

> **脚注**：#41 已合 348cafc，生产 CapabilityCatalogPort=GrantCatalogAdapter，Empty 已删。第四端开通后读口会带「质量检查」，工作台显示三步。本单不改 adapter。A/B 都未合时，main 上按钮仍应是灰的；本单合入才启用按钮。

### 契约钉死（A/B 共用）

1. **提交口。** `POST /api/tenant-admin/v1/quality-ops/check-tasks`，operationId `createCheckTask`。body 只有 `materialText`（必填，1～20000）和可选 `title`（≤200）。`additionalProperties: false`。不传 `inputVersionId` / `configVersionId`。不传 `tenantId`。
2. **材料传法。** 纯文本 JSON。文本框要计字。文本框为空（含只有空白）就禁用「提交检查材料」，不发请求。超过 20000 字同样禁用、不发请求。输入非空白文字且未超长后，按钮才可用。不做文件上传、multipart、进度条、取消。文件约束本片 = 无文件。
3. **成功判定。** 只认 HTTP 201，且同时有 `taskId`（uuid 字符串）、`status==="COMPLETED"`、`result.verdict` 为 `NO_ISSUES` 或 `ISSUES_FOUND`、`result.issues` 为数组且每项有非空 `message`。`ISSUES_FOUND` 必须 `issues.length>0`；`NO_ISSUES` 必须 `issues.length===0`。缺任一按失败处理，不显示结论。人话：`NO_ISSUES`「没有发现需要注意的地方」；`ISSUES_FOUND`「发现 N 处需要注意」，其下按 `issues` 原文顺序逐条列出 `message`，不改写、不截断。N 等于 `issues.length`，用阿拉伯数字。禁用「检查通过」。
4. **结果读法。** 只使用这一次 201。不 GET，不轮询，不听事件流。不写入 `localStorage`。刷新后结果区回到未提交，不保留历史。
5. **失败态（均不显示任何结论）。** 400 →「内容不符合要求」。401，以及没有客户会话时的 403：都引导重新登录或刷新（「请重新登录后再试」或「请刷新页面后再试」）。403 且 `code===CAPABILITY_NOT_OPENED` →「贵企业还没开通「质量检查」，请联系平台管理员开通」。已登录但 CSRF 失败的 403 `ACCESS_DENIED` →「请刷新页面后再试」。404 → 不显示结论（多企业沿用读口失败的现有人话，不新造「检查通过」）。503、超时或网络错误 →「质量检查暂时不可用，请稍后再试」。第四端登录链的既有文案不在本单。
6. **会话。** 只认 `DREAMCORE_SESSION`。前端不传 `tenantId`。CSRF 由 `createIdentityRequest` 自己带。超时把 `withTimeout(signal, 10_000)` 传进 `createIdentityRequest` 的 signal（#46，`src/shared/abort-timeout.ts`）。不要 `FormData`。
7. **门闸。** 页面按读口决定出不出表单，这只是体验。安全边界在后端每次提交重验 `CapabilityCatalogPort`。前端不得自己判断已开通后假装 201。

文案同时对照 [《全端文案规范》](https://www.notion.so/40966c386fbf8120aaefc0290f9dedb8)、[去黑话页](https://app.notion.com/p/40966c386fbf81f3a2e3e1822ae6a9b9)、QUEUE「编制·前端开发」硬性第 6 条。可见文案禁止裸用 `seed` / `capability` / `Capability` / `Grant` / `admission`。

## ① 目标与范围

- **改动点（按前端摸底）**：
  - `src/identity/QualityCheck.tsx`：已开通时去掉按钮禁用；文本框与计字；提交中 / 成功 / 失败三态；结果区只放这一条结果
  - 新建 `src/identity/quality-check-client.ts`
  - `src/identity/AccessApp.tsx` 只透传已有的 `tenant` 或 `opened`，**不改路由**、不改 `view=quality-check` 分支
  - 新建 `tests/e2e/ct043-quality-check-submit.spec.ts`（名匹配 `tests/e2e/ct043-*.spec.ts`）。可复用 `tests/e2e/ct036-empty-shell.spec.ts` 的夹具
  - 同一 PR 同步改 `tests/e2e/ct036-empty-shell.spec.ts`，只改下面两类断言，其余断言保留，不得删弱
- **e2e 覆盖**：未开通无按钮；成功只认合同字段；失败人话且无结论；全文不出现「检查通过」

### ct036 只改这两类断言

文件：`tests/e2e/ct036-empty-shell.spec.ts`。

(a) 已开通时的按钮，以及「执行服务尚未接通」。只动第 83–85、92、121、193、230 行。读口含 `quality-check` 时，按钮断言改成两条：刚加载时文本框为空，按钮 `toBeDisabled()`；在文本框输入非空白文字后，按钮 `toBeEnabled()`。第 84–85 行不再要求「暂时不能提交检查材料（执行服务尚未接通）」和「暂时不能查看处理结果（执行服务尚未接通）」可见，改为这两句 `toHaveCount(0)`。第 86 行「检查通过」数量为 0 不在此列，不得改。

(b) 未开通标题。只动第 169、201、234 行里的「本企业尚未开通此 AI 功能」，改为「贵企业还没开通「质量检查」，请联系平台管理员开通」。第 169 行三元表达式里 404/500 的标题不要改。

其余行一律保留：深链无「② 提交检查材料」、登录墙、请求必须是 GET 且不打 `/agent-admin/`、导航 href、三步标题、读取中的「正在读取」、切企业后无质量检查链接。不得为了变绿删掉这些断言。
- **不做什么**：`apps/api/**`、契约、迁移、文件上传、第四端 grants、企业自助开通

## ② 前置条件与分支名

暂停令 → 停。main 含 `b5c3ab83`。开发不等 A 合入。**合并前 A 必须已在 main。** 仓：`~/Desktop/mengine-app-luofanghao9784`。正式岗 id=`ec838a2d-d838-48cd-a789-e1af1424a7f3`。

```bash
CODEX="/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex"
REPO="$HOME/Desktop/mengine-app-luofanghao9784"
cd "$REPO"
git remote get-url origin | grep -q 'luofanghao9784/mengine-app' || { echo 'ERROR: 错误 remote，停'; exit 1; }
git switch main && git pull
git merge-base --is-ancestor b5c3ab83 HEAD || { echo 'ERROR: main 不含 #46，停'; exit 1; }
git merge-base --is-ancestor 348cafc HEAD || { echo 'ERROR: main 不含 #41，停'; exit 1; }
test -f src/identity/QualityCheck.tsx || { echo 'ERROR: 找不到质量检查现页，停'; exit 1; }
test -f src/identity/client.ts || { echo 'ERROR: 找不到 createIdentityRequest，停'; exit 1; }
test -f src/shared/abort-timeout.ts || { echo 'ERROR: 找不到 withTimeout，停'; exit 1; }
echo 'OK: 可与 A 并行开发。合入必须等 A'
git switch -c codex/ct-043-b-workspace-submit-result
```

## ③ 完整 Codex 提示词

交给 Codex（`gpt-6.1-sol`，思考强度 **high**；本机 `gpt-5.1-codex` 亦可）：

```
你在分支 codex/ct-043-b-workspace-submit-result 上工作。执行单 docs/codex-tasks/CT-043-B-workspace-submit-result.md。
正式岗 id=ec838a2d-d838-48cd-a789-e1af1424a7f3。勿派重复岗。
基准含 b5c3ab83。#41 已合 348cafc，生产 CapabilityCatalogPort=GrantCatalogAdapter，Empty 已删。不要改后端。
契约与 CT-043-A「契约钉死」相同。可 mock。本 PR 合并必须晚于 A。
文案：《全端文案规范》https://www.notion.so/40966c386fbf8120aaefc0290f9dedb8 ；去黑话 https://app.notion.com/p/40966c386fbf81f3a2e3e1822ae6a9b9 ；QUEUE 硬性第 6 条。
禁止裸用 seed、capability、Capability、Grant、admission。禁止出现「检查通过」。

【已裁】
1. QualityCheck.tsx：读口不含 quality-check 时没有提交按钮，标题「贵企业还没开通「质量检查」，请联系平台管理员开通」。含 quality-check 时显示文本框并计字。文本框为空（含只有空白）时「提交检查材料」禁用，不发请求；输入非空白文字且未超过 20000 字后按钮可用。可选标题超过 200 字不发请求。三态：提交中、成功、失败。结果区只显示当前这一条。
2. 新文件 src/identity/quality-check-client.ts。用 createIdentityRequest 发 POST /api/tenant-admin/v1/quality-ops/check-tasks。signal 用 withTimeout(signal, 10_000)。body 只有 materialText 与可选 title。禁止 tenantId，禁止 FormData。
3. AccessApp.tsx 只把已有 tenant 或 opened 透传给 QualityCheck。不改 hash 路由，不改 view 分支。
4. 201 缺 taskId、status!==COMPLETED、verdict 不是那两个、issues 形状不对、或 ISSUES_FOUND 但 issues 为空：当失败，不显示结论。
5. NO_ISSUES 显示「没有发现需要注意的地方」。ISSUES_FOUND 显示「发现 N 处需要注意」，下面按 issues 原文顺序逐条列出 message，不改写、不截断。N 为条数，阿拉伯数字。
6. 400「内容不符合要求」。401，以及没有客户会话时的 403，都引导重新登录或刷新（「请重新登录后再试」或「请刷新页面后再试」），不显示结论。403 CAPABILITY_NOT_OPENED 用未开通那句。已登录但 CSRF 失败的 403 ACCESS_DENIED 仍是「请刷新页面后再试」。503 或超时「质量检查暂时不可用，请稍后再试」。这些都不显示结论。不要改第四端登录链的文案。
7. 不 localStorage。刷新后不留上一次结论。
8. e2e：tests/e2e/ct043-quality-check-submit.spec.ts，可复用 ct036 夹具。覆盖未开通无按钮、成功只认合同字段、失败人话、全文无「检查通过」。拦截若把某字段拿掉，页面不得显示结论。发现问题一例：输入「问题：尺寸超差」，201 为 ISSUES_FOUND 且 message 为「尺寸超差」，页面显示「发现 1 处需要注意」，其下原文「尺寸超差」。没有问题一例：输入「本批记录完整。」，201 为 NO_ISSUES 且 issues 为空，页面显示「没有发现需要注意的地方」，不出现「发现 1 处需要注意」。同一 PR 只按执行单「ct036 只改这两类断言」改 tests/e2e/ct036-empty-shell.spec.ts。

【要做成】
npm run build。npx playwright test tests/e2e/ct043-quality-check-submit.spec.ts tests/e2e/ct036-empty-shell.spec.ts。禁止 -DskipTests。

【不许碰】
apps/api/**、contracts/**、engine/**、workers/parser/**、agent-admin、Flyway、IdentitySecurity、登录端点、force push、直推 main、gh issue、口令入库。
禁止 StubSecurity。禁止第四端 grants。禁止企业自助开通。

【做完】git diff --stat。PR 正文写明须 A 先合。
```

## ④ 推荐模型与思考强度

`gpt-6.1-sol`，思考强度 **high**。把缺字段的 201 或「未通过」画成「检查通过」，就会把 E2 做成假成功。

## ⑤ 可复制 git 步骤

```bash
cd "$HOME/Desktop/mengine-app-luofanghao9784"
git remote get-url origin | grep -q 'luofanghao9784/mengine-app' || exit 1
git add \
  src/identity/QualityCheck.tsx \
  src/identity/quality-check-client.ts \
  src/identity/AccessApp.tsx \
  tests/e2e/ct043-quality-check-submit.spec.ts \
  tests/e2e/ct036-empty-shell.spec.ts
git diff --cached --stat | grep -E 'apps/api|contracts/|engine/|workers/parser|V19' && echo 'ERROR: 禁区' && exit 1
git commit -m "$(cat <<'EOM'
feat(workspace): CT-043-B 质量检查提交与结果接线

已开通时启用文本提交，只认 201 的合同字段。
未开通无按钮。失败不显示结论，不出现检查通过。
EOM
)"
git -c http.proxy= -c https.proxy= push origin codex/ct-043-b-workspace-submit-result
```

网页备用：https://github.com/luofanghao9784/mengine-app/compare/main...codex/ct-043-b-workspace-submit-result

## ⑥ 验收标准

| # | 标准 |
|---|---|
| B1 | 未开通无按钮，人话为指定未开通句，无 POST |
| B2 | 已开通且文本框为空（含只有空白）时按钮禁用。输入非空白文字后按钮可用。超长禁提交。body 无 `tenantId`，无文件 |
| B3 | 201 合同齐全且 `ISSUES_FOUND` →「发现 N 处需要注意」，其下按原文顺序逐条列出 `message`，不改写、不截断 |
| B4 | `NO_ISSUES` →「没有发现需要注意的地方」 |
| B5 | 缺任一合同字段 → 失败，无结论 |
| B6 | 400、401、未开通 403、已登录 CSRF 403、404、503 各自人话且无结论。401 与没有客户会话时的 403 都引导重新登录或刷新 |
| B7 | 全文无「检查通过」，无裸 `capability` / `Grant` / `seed` / `admission` |
| B8 | 刷新不留历史。AccessApp 路由未改 |
| B9 | 客户端用了 `createIdentityRequest` 与 `withTimeout` |
| B10 | ct036 更新后通过。新 ct043 e2e 同时全绿。ct036 只改上述两类断言，其余不得删弱 |
| B11 | A 已合之后才合本单 |

## ⑦ 禁止操作

**硬禁止**：前端闸不是安全边界；未开通必须是指定人话且无按钮；禁 import `agentadmin`；禁读写登记/授权表；禁第四端 grants；禁传 `tenantId`；禁企业自助开通；禁 StubSecurity；401 和没有客户会话时的 403 都引导重新登录或刷新，不得画成已提交；已登录的 CSRF 403 仍显示「请刷新页面后再试」，不得画成成功；失败与缺字段都不显示结论；禁「检查通过」；文案守《全端文案规范》https://www.notion.so/40966c386fbf8120aaefc0290f9dedb8 、去黑话 https://app.notion.com/p/40966c386fbf81f3a2e3e1822ae6a9b9 、QUEUE 硬性第 6 条；禁改 `apps/api`、契约、迁移；禁在 A 合入前把本单并进 main；推送只用 `git -c http.proxy= -c https.proxy= push origin <branch>`；禁 force push、直推 main、口令入库。

### 依赖与并行

| 单 | 关系 |
|---|---|
| 父单 | A/B 合入前 main 上按钮保持灰色 |
| CT-043-A | 同一份契约。开发可并行。**A 先合，B 再合** |
| #41 | 已合 `348cafc`。Empty 已删 |
| #46 | `withTimeout` 已在 main `b5c3ab83` |
| C | 不单列 |

回滚：`git switch main && git branch -D codex/ct-043-b-workspace-submit-result`。
