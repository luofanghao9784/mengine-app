# CT-029 审查号就绪 · 废止方案 A（流程 v1.3.5）

状态：可跑 / 本 PR 落地　｜　分支：`docs/ct-029-end-scheme-a`　｜　审查人：**质量性能 + 发布验收**　｜　基准：`origin/main`

## ① 目标与范围

- **目标**：审查号 `luofanghao1203` 已指定；流程文档与 QUEUE/README **结束方案 A**（**同账号** Comment「放行/可合」过渡废止），合入闸门目标为**非作者正式 Approve**。
- **暂挂说明**：1203 发闸门尚未接通期间 Approve 暂挂；接通前合入留痕用 **`luofanghao1203` 账号**正式 Comment「放行/可合」（禁止开 PR 的 `luofanghao9784` 同账号代闸门）。接通后改回 Approve。
- **改哪些文件**：
  - `docs/验收/梦擎审查门禁与分工流程.md` → **v1.3.5**
  - `docs/codex-tasks/README.md`、`QUEUE.md`（硬性第 5 条 + 编号冻结）
  - 本执行单（归档口径）
- **不做什么**：不改业务代码、workflows、不恢复带红合入；不改两人审/P0+P1/机审第一道。

## ② 前置

纯 docs；免 Mac Codex 业务跑。开 PR 前暂停令自查。

## ③ 验收

- [ ] 正文无「方案 A」「同账号 Comment 暂可算闸门」现行有效表述（修订记录可保留历史）
- [ ] §1 / §4.1 / 开放问题 7 写明审查号 `luofanghao1203` + 方案 A 废止
- [ ] QUEUE 硬性 5、README 合入步骤已对齐
- [ ] 两人审：质量性能 + 发布验收；非作者 `luofanghao1203` Approve（未接通前可用该号 Comment「放行/可合」）

## ④ 模型：不适用（本岗直接改文）　⑤ 预计：30 分钟

## ⑥ 提交

见本 PR。网页：https://github.com/luofanghao9784/mengine/compare/main...docs/ct-029-end-scheme-a

## ⑦ 失败

误弱化 Approve 闸门 → 打回；勿把 Comment 再写成闸门。
