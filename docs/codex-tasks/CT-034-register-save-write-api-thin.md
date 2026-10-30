# CT-034 上架保存写接口薄片（登记 POST 真路径）

状态：架构已裁可跑 · 待 docs 入库后交老板 Mac Codex　｜　分支：`codex/ct-034-register-save-write-api-thin`　｜　**审查人（PR 后两人审）：架构逻辑 + 质量性能**（涉写加 **安全审查** 一眼）　｜　基准：切单时最新 `origin/main`（须含 CT-031 骨架 `capability-registry.openapi.json` 若已合；否则本单可顺带注明实现状态）

> **日切片：2026-10-31 / 可演示点**：本机或预览 API 上对 **真实路径** `POST /api/agent-admin/v1/capabilities` 可 `curl`（允许 **401 / 501** 或最小 **201**）；路径必须真实存在于路由层。禁止「假成功且无落库却 toast 成功」。  
> **挂靠**：两周日切片 D1·轨 A；`docs/codex-tasks/两周日切片-三轨并行-20261031.md`；验收句 **W1** 方向（写通起步，非 W1～W5 全收）。  
> **总负责人不代跑**；老板/后端岗在 Mac 自跑 Codex。Codex 尽量用。登录完整实现属 **CT-035**，本单不做。

规格依据：

- `contracts/public-api/capability-registry.openapi.json`（`operationId: registerCapability` · `POST /api/agent-admin/v1/capabilities`）
- `contracts/public-api/error.schema.json`（错误体形状优先对齐；若 agent-admin 域需扩 code，须在 PR 说明且仍含人话 `message`）
- `docs/architecture/契约分片-检查与能力.md`；ADR-B8 D8-5 / D8-7
- 验收句：[两周主路径验收句](https://www.notion.so/40966c386fbf81ad97cff544bc2906ff)（W1）

> **脚注（诚实 stub）**：当日若只能 stub——须返回 **501 Not Implemented** 或未登录 **401**，JSON 含**人话** `message`（勿堆栈裸抛）；**禁止** 200/201 空成功且无持久化。  
> **脚注（最小落库优先）**：若当日能做最小持久化更好：POST → 201 + 同租户再 GET/名单可查至少一条真记录。表名/迁移最小面；勿借机大重构。

### 架构已裁（2026-10-30 晚 / 2026-10-31 D1，本岗；DQ 可覆）

1. **主路径钉死**：`POST /api/agent-admin/v1/capabilities`（OpenAPI `registerCapability`）。等价「登记/保存」若文档另有别名，以本 POST 为主验收 curl。
2. **薄片三档（由高到低，当日交一档即可）**：
   - **A（优选）**：最小落库 + `201` + 同租户可读回至少 1 条
   - **B**：已挂路由 + 鉴权门闸；未登录 `401` 人话体；登录后若仍未落库则 `501` 人话体（勿假 201）
   - **C（底线）**：控制器/路由存在，无会话也稳定返回 `401` 或 `501` 人话 JSON；`curl -i` 可证路径非 404
3. **不做登录签发**（CT-035）；可复用现有会话/鉴权钩子做 401。
4. **不做前端大改**（人话属 CT-038；接真名单属后续日）。
5. **硬门禁（落库 / A 档前）**：**落库 / A 档持久化之前，必须删除（或彻底替换）`CapabilityRegistryStubSecurity` 中对登记 POST 的 `permitAll` + `csrf.disable()`；换成正式身份鉴权 + CSRF（及既有会话门闸）。禁止在保留 StubSecurity 开放链的情况下落库或返回 201。** 该开放链只许留在无副作用 C 档 stub。

## ① 目标与范围

- **目标**：启动「上架保存」写接口薄片——对齐 capability-registry OpenAPI 的登记 POST；当日可用可复制 `curl` 证明**路径真实**；实现态诚实（落库或 401/501）。
- **增量边界（只做这些）**：
  1. 新增或最小扩展 `apps/api/**` 下 agent-admin 能力登记控制器/服务（包仍在 `com.dreamcore.*` 树内，**勿改包名字符串**）。
  2. 映射 `POST /api/agent-admin/v1/capabilities`；可选同资源 `GET` 列表便于验收回读（若 OpenAPI 已有 `listCapabilities`）。
  3. 请求体最小字段对齐骨架 `Capability`（至少能识别 `enterpriseFunction`；首版演示偏 `quality-check`）。
  4. 错误：401/501（及必要的 400）返回 JSON；`message` **人话**（如「还没有登录，暂时不能登记」「登记保存还在开通中，请稍后再试」）。
  5. 测试：至少 1 个控制器/集成测覆盖「路径存在 + 未实现或未登录诚实态」；若做了落库，再加「同租户可读回」。
  6. 可选：在 `capability-registry.openapi.json` 的 `info.description` 或 path description 注明「CT-034 实现状态：stub|thin-persist」，勿宣称全 Live。
- **改哪些文件（允许）**：
  - `apps/api/src/main/java/com/dreamcore/**`（最小控制器/服务/仓储；**禁止改包名**）
  - `apps/api/src/test/java/com/dreamcore/**`（本单相关测试）
  - 必要时最小迁移（仅本资源表）；须在 PR 写明
  - 可选：`contracts/public-api/capability-registry.openapi.json` 实现状态注释式 description
- **不做什么（非范围）**：
  - 不改前端大段 / 不接 toast 假成功（前端人话 CT-038；接真数据后续日）
  - 不实现四端正式登录完整流（**CT-035**）
  - 不做上架/开通写完整态机、四眼 RETIRE、admission-tests 跑通（后移）
  - 不改 `/mengine-api`、`MENGINE_*` 标识；远程 **mengine-app**
  - 不 force push；不 `gh issue`；禁止假 201 无落库

### 契约贴合点

| 项 | 约定 |
|---|---|
| POST | `/api/agent-admin/v1/capabilities` · `registerCapability` |
| GET（可选回读） | 同 path · `listCapabilities` |
| 错误 | 优先 `$ref` error.schema；人话 `message` 必填感 |
| 租户 | 落库须带租户维度；跨租户不可见（测到再写；当日薄片至少同请求作用域一致） |

## ② 前置条件与分支名

- **⓪ 暂停令自查（第一步，优先级最高）**：有或拿不准 → **立刻停**，问 DQ。
- **依赖**：OpenAPI 骨架宜已在 main（CT-031）；若缺失，本单仍以该 path 字符串为准实现路由，并在 PR 注明。
- 正确仓：`~/Desktop/mengine-app-luofanghao9784`（origin=`luofanghao9784/mengine-app`）。
- Java 包名 `com.dreamcore.*`、`/mengine-api`、`MENGINE_*` **勿改**。

```bash
# ⓪ 暂停令自查：无暂停令再继续
CODEX="/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex"
REPO="$HOME/Desktop/mengine-app-luofanghao9784"
cd "$REPO"
git remote get-url origin | grep -q 'luofanghao9784/mengine-app' || { echo 'ERROR: 错误 remote，停'; exit 1; }
git status
git switch main && git pull
# 确认契约文件（有则对照；无则仍按 path 实现并 PR 注明）
ls contracts/public-api/capability-registry.openapi.json || echo 'WARN: OpenAPI 骨架未合入，按执行单 path 实现'
export JAVA_HOME="$(/usr/libexec/java_home -v 21)"
export POSTGRES_BIN="$(brew --prefix postgresql@18)/bin"
git switch -c codex/ct-034-register-save-write-api-thin
```

## ③ 完整 Codex 提示词

把下面整段交给 Codex（推荐 `$CODEX` + 模型 `gpt-6.1-sol`（若本机已有 `gpt-5.3-codex` 亦可），思考强度 **high**）：

```
你在梦擎仓库分支 codex/ct-034-register-save-write-api-thin 上工作。基准 origin/main。只做本单范围。执行单：docs/codex-tasks/CT-034-register-save-write-api-thin.md。
契约：contracts/public-api/capability-registry.openapi.json（POST /api/agent-admin/v1/capabilities · registerCapability）。
错误样例：contracts/public-api/error.schema.json。ADR-B8 / 契约分片见 docs/architecture/。
两周挂靠：docs/codex-tasks/两周日切片-三轨并行-20261031.md（D1 写接口薄片 · W1 方向）。

【强制口径】
1. 路径必须真实存在：curl 不得得到框架级纯 404「无此路由」（401/501/201 均可）。
2. 禁止假成功：没有持久化就禁止返回 201/200 冒充已保存；stub 用 501 或未登录 401，message 必须人话中文。
3. 不做 CT-035 登录签发；可挂钩现有 Authentication 返回 401。
4. 不做前端大改；不改 com.dreamcore 包名、/mengine-api、MENGINE_*；远程 luofanghao9784/mengine-app。
5. 首版 enterpriseFunction 演示偏 quality-check；勿编造未在契约出现的必填字段。

【A. 路由与控制器】
1. 在 apps/api 增加最小 agent-admin 能力登记 Controller（包路径保持 com.dreamcore.* 既有风格）。
2. 实现 POST /api/agent-admin/v1/capabilities。
3. 优先档 A：校验最小 body → 持久化（最小表/既有表扩展）→ 201 + body；并提供 GET 同集合或按 id 回读，同租户至少 1 条。
4. 若当日不能落库：档 B/C——未登录 401；已登录或无鉴权上下文则 501；JSON 含人话 message（例：「登记保存还在开通中，请稍后再试」）。

【B. 测试】
- 新增测试：POST 路径存在；断言状态码为 401 或 501 或 201（与实现档一致）；禁止断言假 200 空成功。
- 若档 A：再断言同租户回读 ≥1。

【C. 契约注释（可选）】
- 可在 capability-registry.openapi.json 的 info.description 追加「CT-034：stub|thin-persist」字样；勿删骨架、勿宣称全量 Live。

【不许碰】
src/features/** 大改、agent-admin UI 人话（CT-038）、完整登录流（CT-035）、engine/** 业务大改、workers/parser、dist/** 手改、.local/**、口令、force push、reset --hard、直推 main、gh issue。
禁止改 Java 包名 dreamcore、/mengine-api、MENGINE_*。

【本地验收 curl（按实际 API 口改端口；预览约定 api=50831）】
# 底线：路径存在（预期 401 或 501，不是无路由 404）
curl -si -X POST "http://127.0.0.1:50831/api/agent-admin/v1/capabilities" \
  -H "Content-Type: application/json" \
  -d '{"enterpriseFunction":"quality-check"}'

# 若档 A 且有会话 cookie/token，替换鉴权头后再 POST，预期 201；再：
curl -si "http://127.0.0.1:50831/api/agent-admin/v1/capabilities"

单元/集成：在 apps/api 跑本单相关测试（勿用 -DskipTests 掩盖本单红）。

【做完输出】git diff --stat、控制器路径、实现档 A/B/C、可复制 curl 与实测状态码、SKIP 清单。
```

## ④ 推荐模型与思考强度

- 模型：`gpt-6.1-sol`（若本机可用 `gpt-5.3-codex` 亦可）
- 思考强度：**high**（写路径 + 诚实 stub/落库边界，须防假成功）
- **预计耗时**：Codex 40–90 分钟；编译 + 测试 + curl 20–40 分钟

## ⑤ 可复制 git 步骤（跑完如何提交）

```bash
CODEX="/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex"
REPO="$HOME/Desktop/mengine-app-luofanghao9784"
cd "$REPO"
git remote get-url origin | grep -q 'luofanghao9784/mengine-app' || exit 1
# 按实际改动暂存（勿 add 口令/.local）
git add apps/api/src/main apps/api/src/test
# 若有迁移 / OpenAPI 状态注释：
# git add apps/api/src/main/resources/db/migration contracts/public-api/capability-registry.openapi.json
git diff --cached --stat | grep -E 'src/features/agent-admin|workers/parser' && echo 'ERROR: 前端/parser 非本单' && exit 1
git commit -m "$(cat <<'EOM'
feat(api): CT-034 能力登记保存写接口薄片

POST /api/agent-admin/v1/capabilities 真路径；诚实 401/501 或最小 201 落库。
禁止假成功。登录完整流归 CT-035。
EOM
)"
git push -u origin codex/ct-034-register-save-write-api-thin
gh pr create -R luofanghao9784/mengine-app --base main --head codex/ct-034-register-save-write-api-thin \
  --title "feat(api): CT-034 上架保存写接口薄片" \
  --body "## 摘要
对齐 capability-registry：POST /api/agent-admin/v1/capabilities 真路径可 curl；实现档见 PR（A 最小落库 / B·C 诚实 401·501）。

## 可演示 curl
\`\`\`bash
curl -si -X POST \"http://127.0.0.1:50831/api/agent-admin/v1/capabilities\" \\
  -H \"Content-Type: application/json\" \\
  -d '{\"enterpriseFunction\":\"quality-check\"}'
\`\`\`
（端口以预览实测为准；预期 401/501/201，禁止无路由 404；禁止无落库 201）

## 审查
- 两人审：架构逻辑 + 质量性能（涉写加安全审查）
- 挂靠两周日切片 D1 / 验收句 W1
- 勿自动合并

## 非范围
CT-035 登录、前端大改、上架/开通完整态机、假成功 toast"
```

网页备用：https://github.com/luofanghao9784/mengine-app/compare/main...codex/ct-034-register-save-write-api-thin

## ⑥ 验收标准

日可演示（API 口以预览为准；约定目标 api=`50831`）：

| # | 标准 | 如何验 |
|---|---|---|
| V1 | 路径真实 | 上列 `curl -si -X POST …/capabilities` **不是**「无此路由」404 |
| V2 | 诚实态 | 无落库时不得 201/200 成功体；须 401 或 501（或业务 4xx）+ JSON |
| V3 | 人话错误 | 错误 JSON 含可读中文 `message`（非仅英文堆栈） |
| V4 | 档 A 加码（若宣称落库） | POST 201 后，同租户 GET/名单可查 ≥1 条真记录。合入 A 档 PR 前审查人须确认 StubSecurity 开放链已移除 |
| V5 | 测试 | 本单相关测试绿；未用 skip 掩盖 |
| V6 | 边界 | 未改前端大段；未改包名 / `/mengine-api` / `MENGINE_*`；未做 CT-035 |

## ⑦ 禁止操作 / 失败卡住

| 症状 | 动作 |
|---|---|
| remote 不是 mengine-app | 立刻停 |
| 有暂停令 | 不开 Codex；问 DQ |
| curl 404 无路由 | 未完成；补控制器映射后再交 |
| 返回 201 但无落库 | **打回**；改为 501 或补持久化 |
| 落库或返回 201 仍走 StubSecurity 开放链（`permitAll` + `csrf.disable()`） | **打回**；先删除或彻底替换为正式身份鉴权 + CSRF（及既有会话门闸），再落库 |
| 错误体无中文 | 补人话 message |
| 误改前端 / 包名 / mengine-api | `git restore`；报 DQ |
| 测试红 | 修到绿；禁止 `-DskipTests` 掩盖本单 |
| CONFLICT / push rejected | `git pull --rebase` 一次；仍失败停发 DQ |

**硬禁止**：

- `git push --force` / `-f` / `--force-with-lease`、`git reset --hard`、直推 `main`
- **假成功**（无落库 201/200 + 前端成功暗示）
- **保留 StubSecurity 开放链却落库或返回 201**：落库 / A 档持久化之前，必须删除（或彻底替换）`CapabilityRegistryStubSecurity` 中对登记 POST 的 `permitAll` + `csrf.disable()`；换成正式身份鉴权 + CSRF（及既有会话门闸）
- 完整登录实现（CT-035）、前端人话大改（CT-038）、假 Live 列表
- 改 `com.dreamcore.*` 包名、`/mengine-api`、`MENGINE_*`
- `gh issue create/comment`；含口令提交
- 有暂停令仍开 Codex

回滚（未合入）：`git switch main && git branch -D codex/ct-034-register-save-write-api-thin`。

---

**DQ 审路径**：本文件 + 两周日切片 D1·A + 验收句 W1。通过后交老板/后端岗 Mac 粘贴③开跑。涉写合入前请安全审查一眼。
