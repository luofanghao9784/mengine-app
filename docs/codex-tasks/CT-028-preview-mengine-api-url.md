# CT-028 预览 vite 将 `/mengine-api` 指到动态 scene 口

状态：待执行　｜　分支：`codex/ct-028-preview-mengine-api-url`　｜　**审查人（两人审）：质量性能 + 发布验收**　｜　类型：预览脚本 / trial　｜　基准：切单时最新 `origin/main`　｜　日切片：2026-10-30 后 / 可演示点：bounce 后无须手改即可 `#place=data` 拉到 scene

> **背景（2026-10-30 漏斗验收）**  
> `vite.config.ts` 的 preview/server 代理把 `/mengine-api` 默认打到 `http://127.0.0.1:4400`（可用 `MENGINE_API_URL` 覆盖）。`scripts/local/trial.py` 启动隔离 scene 时用 `free_port()`（如 58497/63712），却只给 Java 设了 `MENGINE_PLATFORM_BRIDGE_*`，**未**把 `MENGINE_API_URL` 写入 **web（vite preview）** 环境 → 代理仍连 4400 → `ECONNREFUSED` → 企管端数据基座「数据服务暂不可用」。  
> 当晚兜底：本机 `4400→scene` 转发 + bounce；正式验收路径为 **#5 登录** + `http://127.0.0.1:{web}/tenant-admin/#place=data`（主视觉线索漏斗 120/72/45/18 已过）。  
> **DQ**：把「preview-start / trial 须把 `/mengine-api` 指到动态 scene 口」固化进本单，避免每次 bounce 手改。

## ① 目标与范围

- **目标**：scene 启动后，vite preview 的 `/mengine-api` 代理目标等于该次 `scene_port`，bounce/restart 后无需手改端口或起 4400 转发。
- **改哪些文件（尽量少）**：
  1. **必改** `scripts/local/trial.py`：在已算出 `scene_port` 且 scene `ready` 之后、启动 web 之前，令  
     `web_env` 含 `MENGINE_API_URL=f"http://127.0.0.1:{scene_port}"`（与现有 `DREAMCORE_DEV_API_URL` 并列）。无 scene（无 `scene-private.json` / 未启 scene）时**不要**设该键（保持默认 4400 或未定义均可，与今日无 scene 行为一致即可）。
  2. **建议（一行运维注释，可选）** `scripts/preview/preview-start.sh` 或 `preview-health.sh`：注明「含 scene 时 web 须带 `MENGINE_API_URL`→动态 scene；勿假定 4400」。
  3. **可选文档**：`docs/codex-tasks/CT-006-mac-preview-land.md` 文末「已知运维注意」加 3～5 行指向本 CT（不改 CT-006 已合入的落地清单语义）。
- **不做什么**：
  - 不改 `vite.config.ts` 默认 4400（保留本地 dev 约定）；不改 Java 业务、前端 DataWork、mengine 业务逻辑。
  - 不把 scene 固定死到 4400；不引入 Homebrew；不对上游 `dimmm1125-coder` 写操作。
  - **不修** `/tenant-admin/prototype/` 免登不通（另见下文 P1；今晚不修）。
  - 禁止 commit/push/gh 由 Codex 执行；禁止开 Issue；PR 只允许 `-R luofanghao9784/mengine`。

### 验收（Mac 预览）

1. 实例含 `scene-private.json`：`preview-stop` → `PREVIEW_PHONE_LOCAL=1 preview-start`（或等价 trial start）。
2. `ps eww`（或等价）可见 vite 进程环境含 `MENGINE_API_URL=http://127.0.0.1:<scene口>`，且该口 `/api/health` 为 Mengine Wiki ok。
3. **不必**再起 4400 转发；`curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:{web}/mengine-api/scene-foundation` 为 **401**（未登录）而非代理层连接失败。
4. #5 登录后 `…/api/tenant-admin/v1/tenants/{A}/scene/dispatch?path=%2Fscene-foundation` **200** 且含数据（有灌样时）。
5. 浏览器：`tenant-admin/#place=data` 硬刷新，**无**「数据服务暂不可用」（有灌样时可核对漏斗数字）。

## ② 前置条件与分支名

- **⓪ 暂停令自查**：有暂停令或拿不准 → 禁止 Codex / 禁止推送，问 DQ。
- 依赖：无硬依赖未合 CT；建议在 CT-006 落地脚本已在用的仓上改。
- 正确仓：`~/Desktop/mengine-luofanghao9784`（origin=`luofanghao9784/mengine`）。

```bash
CODEX="/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex"
REPO="$HOME/Desktop/mengine-luofanghao9784"
cd "$REPO"
git remote get-url origin | grep -q 'luofanghao9784/mengine' || { echo 'ERROR: 错误 remote，停'; exit 1; }
git switch main && git pull
git switch -c codex/ct-028-preview-mengine-api-url
# 暂停令自查通过后：codex 粘贴第 ③ 节；或交付运维按提示词手工改
```

## ③ 完整 Codex 提示词（整段复制）

```text
你在 dreamcore-workspace（老板 fork）。任务：试用预览启动 scene 后，让 vite preview 的 /mengine-api 代理打到该次动态 scene 端口。

【硬约束】
1. 主要只改 scripts/local/trial.py。可选：scripts/preview/preview-start.sh 或 preview-health.sh 加一行中文注释；可选 docs/codex-tasks/CT-006-mac-preview-land.md 文末「已知运维注意」短节指向 CT-028。禁止改 vite.config.ts、Java、前端业务、mengine 源码。
2. 现状：start() 里 scene_port = free_port()，scene 子进程 API_PORT=scene_port；web_env 目前只有 DREAMCORE_DEV_API_URL 指向 Java。vite preview 用 process.env.MENGINE_API_URL || http://127.0.0.1:4400。
3. 修复：当本次 start 实际启动了 scene（scene_path 存在且 scene 已 ready）时，web_env 必须包含 MENGINE_API_URL=f"http://127.0.0.1:{scene_port}"。未启 scene 时不要设 MENGINE_API_URL（或明确保持与改前一致）。
4. 禁止把 scene 绑死 4400；禁止 commit、push、gh、改 remote。做完只输出 diff。

【验收自检】
- git diff --stat 以 trial.py 为主，行数小。
- 说明：有 scene 时 web 环境含 MENGINE_API_URL；无 scene 时行为与改前一致。

【做完输出】
1. 改动文件列表与完整 diff；
2. 一句话：bounce 后无需 4400 转发，/mengine-api 指向动态 scene。
```

## ④ 本地验证（交付运维 / 老板）

见 §① 验收。日志与 PR **不写** bridge key / 账号口令。

## ⑤ 开 PR

- 标题：`docs(ct-028): preview MENGINE_API_URL → 动态 scene 口`
- 正文：链本执行单；说明漏斗验收正式入口 `#place=data`；prototype 免登不在范围。
- `-R luofanghao9784/mengine`；禁止 force push。

## ⑥ 审查与合入

- 机审：`CODEX-REVIEW-PROMPT.md` Comment。
- 人审：**质量性能 + 发布验收**（过渡期正式 Comment「放行/可合」）。
- 合入后由交付运维在 Mac 按 §① 验收点开一次。

## ⑦ 回滚

还原 `trial.py` 中 `web_env` 对 `MENGINE_API_URL` 的赋值即可；临时兜底仍可用本机 `4400→scene` 转发。

---

## 附录：相关 P1（本单不修）

| 项 | 说明 | 处置 |
|---|---|---|
| prototype 免登 | 裸开 `/tenant-admin/prototype/` 无企业会话 / 未 `setSceneTenant` → 直打 `/mengine-api` 需 scene 登录 → 「数据服务暂不可用」；正式路径 `#place=data`（企管壳注入 tenant）已验收通过 | **P1 / 后续 CT**；DQ 2026-10-30：今晚不修 |
