# CT-042 第四端「开通给企业」按钮接线

> **现状**：#41 已合 348cafc，生产 CapabilityCatalogPort=GrantCatalogAdapter，Empty 已删。下文若仍写 #41 未合或 Empty 仍在，以本句为准。

状态：架构已裁可跑 · 待 docs 入库后交老板 Mac Codex　｜　**正式岗** id=`ec838a2d-d838-48cd-a789-e1af1424a7f3`（勿派重复岗）　｜　分支：`codex/ct-042-agent-admin-grant-tenant-button`　｜　**审查人（实现 PR 后）：发布验收 + 质量性能 + 架构逻辑 + 安全审查**　｜　基准：本执行单 docs 对照 `a514be5` / [#36](https://github.com/luofanghao9784/mengine-app/pull/36)（CT-041 执行单）。其前已在 main 的还有：CT-040 执行单 `727063f` / [#33](https://github.com/luofanghao9784/mengine-app/pull/33)、#35 接真 `7fa4946`、CT-037 `1d847e6` / #32、CT-039 实现 `701c3ca` / [#31](https://github.com/luofanghao9784/mengine-app/pull/31)、CT-034-A 实现 `75ab17a` / [#30](https://github.com/luofanghao9784/mengine-app/pull/30)、人话 `e339056` / #15（CT-038）。**开通写实现尚未合入**，见脚注【待合-CT-040-实现】。

> **日切片：D6 前端写侧 / 可演示点**：已登录第四端后，打开现页 `#view=capability-registry&tab=grants`。原灰钮「开通给企业」可点。填入真实或演示企业编号，功能为已登记的质量检查。点击后网络面板出现 `POST /api/agent-admin/v1/tenants/{tenantId}/grants`。**201** 才显示开通成功；再点一次见到 **200** 或「已开通」，页面不长出假名单。未登录点下去被人话挡住，不显示开通成功。  
> **挂靠**：两周日切片·轨 B。验收句 **W1** 里「开通给企业」的按钮，不是写口本身（[CT-040](CT-040-agent-admin-grant-tenant-opened.md)），不是企业读口（CT-039 / [CT-041](CT-041-catalog-read-from-tenant-grants.md)），不是消费页（CT-036），不是现网冒烟（CT-037），也不是质量检查最小写通（顺延 **CT-043**，本单不写）。`docs/codex-tasks/两周日切片-三轨并行-20261031.md`。  
> **总负责人不代跑**；老板 / 正式前端岗在 Mac 自跑 Codex。模型 `gpt-6.1-sol`，思考强度 **high**（本机若是 `gpt-5.1-codex` 亦可）。  
> **仓**：`luofanghao9784/mengine-app`。

规格依据：

- 开通写（对照，本单不实现）：[`CT-040-agent-admin-grant-tenant-opened.md`](CT-040-agent-admin-grant-tenant-opened.md)（执行单 `727063f` / #33）。唯一调用 `POST /api/agent-admin/v1/tenants/{tenantId}/grants`，operationId `createCapabilityTenantGrant`。body 只有 `capabilityId` 与 `enterpriseFunction`，`additionalProperties: false`。Cookie `DREAMCORE_AGENT`。头 `X-CSRF-TOKEN`。人话与状态码以该单「请求 / 表 / 响应」为准
- 人话壳已合：[`CT-038-agent-admin-human-copy.md`](CT-038-agent-admin-human-copy.md)（`e339056` / #15）。按钮文案保持 **开通给企业**。现页：`src/features/agent-admin/AgentAdminApp.tsx` 企业开通页（`tab=grants`）该钮 `disabled`，`title` 为「暂时不能开通（后台开通中）」。版本页「上架功能」仍灰
- 读口真源不挡本单：[`CT-041-catalog-read-from-tenant-grants.md`](CT-041-catalog-read-from-tenant-grants.md)（**执行单已合** `a514be5` / #36）。企业侧仍是 `GET /api/tenant-admin/v1/opened-capabilities`。本按钮不调用它，不等它的实现
- 文案：[《全端文案规范》](https://www.notion.so/40966c386fbf8120aaefc0290f9dedb8)、[Agent管理去黑话 · 可演示口径](https://app.notion.com/p/40966c386fbf81f3a2e3e1822ae6a9b9)、[体验落部 · UX](https://app.notion.com/p/40966c386fbf8142b0bbcb16d1876e8f)。QUEUE「编制·前端开发」硬性第 6 条：可见文案禁止裸用 `seed` / `capability` / `Capability` / `Grant` / `admission`
- 今日 CSRF：`GET /api/agent-admin/v1/auth/csrf` 返回 `token` 与 `headerName`（今日为 `X-CSRF-TOKEN`）。Cookie 名 `DREAMCORE_AGENT`，HttpOnly，脚本不读它的值。未登录写 401「还没有登录，请先登录后再试」；有会话无/错 CSRF 403「登录校验未通过，请刷新页面后再试」
- 输入样式已在 `.admin-control`（`src/admin/admin.css`）。登记面板 `RegisterDialog.tsx` 的 label + input 可照现页，不要新皮肤

> **脚注（【待合-CT-040-实现】）**：CT-040 **执行单已合** main `727063f` / #33。开通写实现（表 `qo_capability_tenant_grant` + POST 控制器）**尚未合入**。本执行单 docs 可先合，**不绑 Mac**。实现开跑时 main 必须含该实现 tip；脚注仍是【待合-CT-040-实现】，或②里 SHA 仍是占位 → **停**。合入后把本句改成「CT-040 实现已合 `<SHA>`」，②取消注释并写入同一个 SHA，再在 Mac 重跑（空位补上后重跑）。在此之前 Codex 不改按钮。后端未合时，即使按钮日后可点，也只能诚实失败，禁止显示开通成功。  
> **脚注（CT-041 不挡）**：CT-041 **执行单已合** main `a514be5` / #36。它的读口实现仍等 CT-040 实现，**不挡**本前端写。本单不改 `EmptyCapabilityCatalogAdapter`，不调用企业读口，不实现 grants GET。

### 架构已裁

1. **只接现页这一颗钮。** `#view=capability-registry&tab=grants` 上原文案「开通给企业」去掉 `disabled`，可点。风格、动效、壳子跟随现 agent-admin，不另起页面、不换肤。版本页「上架功能」保持 `disabled` 与原 `title`。catalog 的「登记实现方案 / 保存登记」、侧栏「预览页面 · 无需登录」、hash 路由键都不改。
2. **调用钉死。** 仅 `POST /api/agent-admin/v1/tenants/{tenantId}/grants`。`credentials: 'same-origin'`。先 `GET /api/agent-admin/v1/auth/csrf`，把头设成响应里的 `headerName` 与 `token`。body 只有这两项，不多不少：`{"capabilityId":"quality-check","enterpriseFunction":"quality-check"}`。路径上的企业编号来自表单，不放进 body。禁止 `GET` 这条 grants，禁止 `POST /api/agent-admin/v1/capabilities`，禁止企业读口，禁止 `/api/platform-admin/**` 与 `/api/tenant-admin/**`。
3. **禁假成功。** 只有 HTTP **201** 或 **200**，且 JSON 同时带非空 `tenantId`、`capabilityId`、`enterpriseFunction`、`grantedAt`，才算开通成功。201 的状态句是「已开通给这家企业」。200 的状态句是「已开通」。骨架占位、501、405、网络失败、或 201/200 但缺这四字段：状态句「这次没有开通成功」，**不得**出现开通成功。禁止 toast。禁止本地数组、本地缓存或「已开通」标记冒充名单，也禁止因此跳过下一次 POST。空态标题「尚无可展示的企业开通记录」保持，成功不往页面插一行。
4. **人话对照 CT-040，整句照抄。** 401 →「还没有登录，请先登录后再试」。403 →「登录校验未通过，请刷新页面后再试」。400 / 404 / 409 只在 `message` **整句等于**下面某一句时原样显示，否则用「这次没有开通成功」：
   - 「请按要求填写开通内容」
   - 「有无法识别的字段，请检查后再提交」
   - 「没有这个企业，不能开通」
   - 「还没有这项登记，请先登记再开通」
   - 「已经开通过了，不能改成另一项」
   409 不是成功。企业编号为空：不发请求，状态句用「请按要求填写开通内容」。
5. **表单最小。** 同一空态面板里加两行，沿用现页 label + input，不新组件库。标签「企业」，占位「填写企业编号」，不预填假编号，可见文案不写 tenantId。标签「企业功能」，只读，可见「质量检查」。提交值固定 `quality-check` / `quality-check`，界面不展示英文 key 当按钮或成功句。请求进行中钮暂时不可点，状态句「正在开通…」；结束后恢复可点，以便再点看到 200。
6. **非范围。** 精致开通页、批量开通、grants GET、企业侧自开通、登记 POST、假 Live、假已上架列表。不新做登录页，不改 `AgentAdminSecurity`。不改 apps/api、契约、迁移。质量检查最小写通（员工端 / 工作台把「质量检查」走通）顺延 **CT-043**，本单不写、不改 `src/identity/QualityCheck.tsx`。CT-041 读口实现不在本单。

## ① 目标与范围

- **目标**：第四端现页的「开通给企业」从灰变为可点，并只调用已钉死的开通 POST。后端写口还没合入时，点击只能诚实失败。有符合形状的 201/200 才说开通成功。重复点击仍发 POST，不刷新假名单。
- **增量边界**：
  1. grants 页该钮可点；版本页「上架功能」仍灰。
  2. 企业编号 + 只读「质量检查」；body 与路径按架构已裁第 2 条。
  3. 状态句按第 3、4 条。不 toast，不插名单行。
  4. `probeCapabilities` 仍只做连通探测，不得改成「已开通」或假列表。
- **改哪些文件（允许）**：
  - `src/features/agent-admin/AgentAdminApp.tsx`（grants 面板上的钮与两行输入、状态句）
  - `src/features/agent-admin/client.ts`（新增这一次 POST；探测函数的成功条件不变）
  - `src/features/agent-admin/agent-admin.css`（仅当现有空态居中放不下这两行时，补对齐；不改色、不改动效）
- **不做什么**：见架构已裁第 6 条。

## ② 前置条件与分支名

- **⓪ 暂停令自查（第一步）**：有或拿不准 → 立刻停，问 DQ。
- **⓪b 实现 tip**：脚注仍是【待合-CT-040-实现】，或下面 SHA 仍是占位 → **停**。不要改按钮。合入后由架构改 SHA，再把本段交给 Codex，在 Mac 重跑。
- **依赖**：CT-038 人话已在 main（`e339056`）。CT-040 **执行单**已合（`727063f`）。CT-041 **执行单**已合（`a514be5`），不挡本单。CT-040 **实现**必须已在所切的 main 上（表 + POST）。本单不实现写口，也不实现读口。
- 正确仓：`~/Desktop/mengine-app-luofanghao9784`（origin=`luofanghao9784/mengine-app`）。
- 正式岗 id=`ec838a2d-d838-48cd-a789-e1af1424a7f3`。

```bash
CODEX="/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex"
REPO="$HOME/Desktop/mengine-app-luofanghao9784"
cd "$REPO"
git remote get-url origin | grep -q 'luofanghao9784/mengine-app' || { echo 'ERROR: 错误 remote，停'; exit 1; }
git status
git switch main && git pull
git merge-base --is-ancestor e339056 HEAD || { echo 'ERROR: main 不含 CT-038 人话，停'; exit 1; }
git merge-base --is-ancestor 727063f HEAD || { echo 'ERROR: main 不含 CT-040 执行单，停'; exit 1; }
git merge-base --is-ancestor a514be5 HEAD || { echo 'ERROR: main 不含 CT-041 执行单，停'; exit 1; }
# 【待合-CT-040-实现】合入后删掉行首 #，把 REPLACE_WITH_CT040_IMPL_SHA 换成已合 tip。占位未改就停。
# git merge-base --is-ancestor REPLACE_WITH_CT040_IMPL_SHA HEAD || { echo 'ERROR: main 不含 CT-040 实现，停'; exit 1; }
git grep -l qo_capability_tenant_grant -- 'apps/api/src/main/resources/db/migration-common/*.sql' || { echo 'ERROR: 【待合-CT-040-实现】授权表不在本分支，停。本单禁止建表。'; exit 1; }
git grep -n "createCapabilityTenantGrant" -- apps/api/src/main '*.java' || { echo 'ERROR: 【待合-CT-040-实现】开通 POST 不在本分支，停。'; exit 1; }
git switch -c codex/ct-042-agent-admin-grant-tenant-button
```

## ③ 完整 Codex 提示词

把下面整段交给 Codex（`$CODEX`，模型 `gpt-6.1-sol`，思考强度 **high**；本机若是 `gpt-5.1-codex` 亦可）：

```
你在梦擎仓库分支 codex/ct-042-agent-admin-grant-tenant-button 上工作。只做本单范围。执行单：docs/codex-tasks/CT-042-agent-admin-grant-tenant-button.md。
正式岗 id=ec838a2d-d838-48cd-a789-e1af1424a7f3。勿派重复岗。
对照：docs/codex-tasks/CT-040-agent-admin-grant-tenant-opened.md（POST 与人话）、docs/codex-tasks/CT-038-agent-admin-human-copy.md（按钮文案）、docs/codex-tasks/QUEUE.md 编制·前端开发硬性第 6 条。
文案必须同时对照：《全端文案规范》https://www.notion.so/40966c386fbf8120aaefc0290f9dedb8 ；去黑话 https://app.notion.com/p/40966c386fbf81f3a2e3e1822ae6a9b9 ；体验落部 https://app.notion.com/p/40966c386fbf8142b0bbcb16d1876e8f 。
可见文案禁止裸用 seed、capability、Capability、Grant、admission。按钮就叫「开通给企业」。
今日页面：src/features/agent-admin/AgentAdminApp.tsx。路由 #view=capability-registry&tab=grants 时，空态里有 disabled 按钮「开通给企业」。tab=versions 的「上架功能」保持 disabled。client.ts 的 probeCapabilities 只探测 GET /api/agent-admin/v1/capabilities，不要改它的成功条件。
CT-041 执行单已合 a514be5。它的读口实现不挡本单。不要调用 GET /api/tenant-admin/v1/opened-capabilities，不要改 adapter。
两周挂靠：docs/codex-tasks/两周日切片-三轨并行-20261031.md。本单不是质量检查最小写通（那是 CT-043，不要写、不要改 QualityCheck）。

【开跑门】
执行单脚注若仍写【待合-CT-040-实现】，或②里的实现 SHA 仍是 REPLACE_WITH_CT040_IMPL_SHA，立刻停，不要改业务代码。授权表或开通 POST 不在本分支，同样停。禁止自己写后端，禁止建表。

【已裁】
1. 只把 grants 页「开通给企业」变成可点。不新开页面，不换皮肤，不改 hash。版本页「上架功能」仍灰，title 仍是「暂时不能上架（后台开通中）」。不改「保存登记」。不改侧栏「预览页面 · 无需登录」。不新做登录页。
2. 每次点击都 POST /api/agent-admin/v1/tenants/{企业编号}/grants。credentials 用 same-origin。先 GET /api/agent-admin/v1/auth/csrf，请求头用返回的 headerName 与 token（今日 headerName 为 X-CSRF-TOKEN）。不要读 DREAMCORE_AGENT 的值，不要把它放进 localStorage。body 只能是 {"capabilityId":"quality-check","enterpriseFunction":"quality-check"}。不要加 moduleVersionId、isDefault、tenantId、grantedBy、grantedAt。不要 GET grants。不要 POST /api/agent-admin/v1/capabilities。
3. 禁假成功。仅当状态是 201 或 200，且 JSON 有非空 tenantId、capabilityId、enterpriseFunction、grantedAt，才算成功。201 的状态句：「已开通给这家企业」。200 的状态句：「已开通」。其他一切（含 501、405、网络失败、骨架 201、缺字段）状态句：「这次没有开通成功」。禁止 toast。禁止本地名单。空态标题「尚无可展示的企业开通记录」留着。成功不插入一行。本地不得记住「已开通」然后跳过下一次 POST。
4. 人话整句照抄，不要改写。401：「还没有登录，请先登录后再试」。403：「登录校验未通过，请刷新页面后再试」。400/404/409 仅当 message 整句等于下列之一才显示该句，否则「这次没有开通成功」：「请按要求填写开通内容」「有无法识别的字段，请检查后再提交」「没有这个企业，不能开通」「还没有这项登记，请先登记再开通」「已经开通过了，不能改成另一项」。409 不是成功。企业编号 trim 后为空：不发请求，状态句「请按要求填写开通内容」。
5. 同一空态面板加两行，用现成 label 与 input。标签「企业」，占位「填写企业编号」，不预填。标签「企业功能」，只读，可见文字「质量检查」。不要用英文 key 当按钮或成功句。请求未完成时按钮暂时 disabled，状态句「正在开通…」；结束后按钮恢复可点。状态句用 role=status。不要新 toast 库。
6. 非范围：精致开通页、批量、grants GET、企业自开通、登记 POST、假 Live、登录签发、apps/api、契约、迁移、CT-041 读口、CT-043 质量检查最小写通、src/identity/QualityCheck.tsx。

【要做成】
1. 在 client.ts 增加一次开通请求函数。探测函数保持原样。
2. grants 面板接上企业编号、只读质量检查、可点的「开通给企业」、一条状态句。
3. 样式只许沿用 admin-control 已有 input。css 仅在空态放不下这两行时补对齐，不改颜色与动效。
4. npm run build 须过。不要 -DskipTests，本单也没有后端测试可跳。

【不许碰】
apps/api/**、contracts/**、engine/**、workers/parser/**、src/identity/QualityCheck.tsx、src/admin/OpenedFunctions.tsx、src/demo/**、AgentAdminSecurity、Flyway、登录端点、force push、reset --hard、直推 main、gh issue、口令入库。
禁止恢复 CapabilityRegistryStubSecurity。
禁止改 Java 包名 dreamcore、/mengine-api、MENGINE_*。
禁止把「上架功能」或「保存登记」变成可点。

【验收】
npm run build
Mac 预览（端口以 preview-health 的 webUrl 为准；目标 web 50832）：
http://127.0.0.1:50832/agent-admin/#view=capability-registry&tab=grants
已登录第四端（已有 DREAMCORE_AGENT；口令不进仓库）。企业编号用真实或演示 UUID。功能是已登记的质量检查。
点「开通给企业」：网络面板见 POST /api/agent-admin/v1/tenants/<uuid>/grants，body 只有 capabilityId 与 enterpriseFunction，且都是 quality-check，并带 CSRF 头。
201 且四字段齐全：页面出现「已开通给这家企业」，没有新名单行。
再点一次：仍见 POST；200 且四字段齐全时出现「已开通」；不刷新假数据。
无 Cookie 再点：出现「还没有登录，请先登录后再试」，不出现开通成功。
版本页「上架功能」仍不可点。

【做完输出】git diff --stat、grants 钮不再 disabled 的位置、确认没有 grants GET、没有本地假名单、没有改版本页灰钮、没有改后端。
```

## ④ 推荐模型与思考强度

- 模型：`gpt-6.1-sol`（与 CT-040 相同；本机若是 `gpt-5.1-codex` 亦可）
- 思考强度：**high**（把 501 或本地状态当成开通成功、顺手做 grants GET、或把质量检查页写成开通，都会把 W1 做成假开通）
- **预计耗时**：Codex 25–45 分钟；`npm run build` 与预览点按 15–25 分钟

## ⑤ 可复制 git 步骤（跑完如何提交）

```bash
REPO="$HOME/Desktop/mengine-app-luofanghao9784"
cd "$REPO"
git remote get-url origin | grep -q 'luofanghao9784/mengine-app' || exit 1
git add src/features/agent-admin
git diff --cached --stat | grep -E 'apps/api|contracts/|engine/|workers/parser|QualityCheck|OpenedFunctions' && echo 'ERROR: 禁区' && exit 1
git commit -m "$(cat <<'EOM'
feat(agent-admin): CT-042 开通给企业按钮

企业开通页的「开通给企业」改为可点，只调用开通 POST。
201/200 且四字段齐全才显示成功。未登录仍是人话失败。
EOM
)"
git push -u origin codex/ct-042-agent-admin-grant-tenant-button
gh pr create -R luofanghao9784/mengine-app --base main --head codex/ct-042-agent-admin-grant-tenant-button \
  --title "feat(agent-admin): CT-042 开通给企业按钮" \
  --body "## 摘要
第四端现页「开通给企业」可点，只 POST /api/agent-admin/v1/tenants/{tenantId}/grants。body 只有 capabilityId 与 enterpriseFunction。201/200 且四字段齐全才显示开通成功。重复点击仍发 POST，不插假名单。未登录显示「还没有登录，请先登录后再试」。

## 可演示
- http://127.0.0.1:50832/agent-admin/#view=capability-registry&tab=grants
- 网络面板见上述 POST。版本页「上架功能」仍灰。

## 验收句
W1 的开通按钮。不是 CT-040 写口实现，不是 CT-041 读口，不是 CT-043 质量检查最小写通。

## 审查
- 发布验收 + 质量性能 + 架构逻辑 + 安全审查
- 正式岗 id=ec838a2d-d838-48cd-a789-e1af1424a7f3
- 《全端文案规范》+ 去黑话对照 + 体验落部
- 不得在无 201/200 时显示开通成功
- 勿自动合并"
```

网页备用：https://github.com/luofanghao9784/mengine-app/compare/main...codex/ct-042-agent-admin-grant-tenant-button

## ⑥ 验收标准

日可演示（Mac `127.0.0.1`，端口以预览为准；约定目标 web=`50832`）：`/agent-admin/#view=capability-registry&tab=grants`。

| # | 标准 | 如何验 |
|---|---|---|
| G1 | 钮可点 | grants 页「开通给企业」无 `disabled`。文案仍是这五个字。版本页「上架功能」仍灰 |
| G2 | 只调开通 POST | 网络面板见 `POST /api/agent-admin/v1/tenants/{uuid}/grants`。body 仅 `capabilityId` 与 `enterpriseFunction`，值都是 `quality-check`。带 Cookie 与 CSRF 头。无 grants GET，无登记 POST |
| G3 | 201 才成功 | 四字段齐全的 201 →「已开通给这家企业」。无名单新行 |
| G4 | 重复 | 再点仍发 POST。四字段齐全的 200 →「已开通」。不刷新假数据 |
| G5 | 未登录被挡 | 无 `DREAMCORE_AGENT` →「还没有登录，请先登录后再试」。不出现开通成功 |
| G6 | 其他人话 | 403 / 400 / 404 / 409 按架构已裁第 4 条整句。对不上的响应用「这次没有开通成功」 |
| G7 | 无假成功 | 501、缺字段、网络失败都不显示开通成功。无 toast。探测函数不改成已开通 |
| G8 | 风格 | 仍是现 agent-admin 空态。不新皮肤。hash 不变 |
| G9 | 边界 | 无 `apps/api`、契约、迁移、`QualityCheck.tsx` diff。可见文案无裸术语 |
| G10 | build | `npm run build` 通过。本单新引入红必须清 |

## ⑦ 禁止操作 / 失败卡住

| 症状 | 动作 |
|---|---|
| remote 不是 mengine-app | 立刻停 |
| 有暂停令 | 不开 Codex；问 DQ |
| 脚注仍是【待合-CT-040-实现】 | 停。不要为了「先可点」改按钮。等实现 tip 写入②后再跑 |
| main 不含 `a514be5` | 停；先拉含 CT-041 执行单的 main。CT-041 实现未合不挡本单 |
| 无 201/200 却显示开通成功，或出现 toast | **打回** |
| 本地插入「已开通」行，或第二次点击不再 POST | **打回** |
| 调用了 grants GET、登记 POST 或企业读口 | **打回** |
| 「上架功能」或「保存登记」变成可点 | **打回** |
| 改了后端、契约或质量检查页 | `git restore`；报 DQ |
| build 红 | 修到绿 |
| CONFLICT / push rejected | rebase 一次；仍失败停 |

**硬禁止**：

- 后端未合或响应不是齐全的 201/200 时显示开通成功
- 前端本地假名单、假 Live、跳过第二次 POST
- 实现 grants GET、企业自开通、登记 POST、登录页
- 把本单做成质量检查最小写通（CT-043）或 CT-041 读口
- 改 `permitAll`、建表、改 V191 / V192 / V193
- `git push --force`、`git reset --hard`、直推 `main`
- 改包名、改 `/mengine-api`、改 `MENGINE_*`
- `gh issue`；口令进仓库
- 有暂停令仍开 Codex

回滚（未合入）：`git switch main && git branch -D codex/ct-042-agent-admin-grant-tenant-button`。

---

**DQ 审路径**：本文件「架构已裁」+ CT-040 的 POST / 人话原文 +《全端文案规范》与去黑话对照。通过后，等【待合-CT-040-实现】写成已合 SHA，再交老板 / 正式前端岗 Mac 粘贴③开跑。安全审查必看：只带 `DREAMCORE_AGENT` 与 CSRF，无 201/200 不得显示开通成功。总负责人不代跑。
