# site/src/engine

官网首页那台 3D 引擎用的代码，从本仓库复制而来（基线提交 59d6fd3，2026-10-10），只由合成的“繁忙演示”数据驱动，不连接后台。

来源：`src/operations/engine-stage/`、`src/operations/engine-dashboard-model.ts`、`src/operations/engine-demo.ts`、`contracts/public-api/`。除 import 路径和 `shims.ts` 外，对 `engine-stage/scene.ts` 有四处官网专用的追加，默认值下行为与原文件一致：

- `zoom`、`shift`：全景视角的远近与左右偏移，用来放大核心并让到文字旁边；`shift` 也作用于输入、输出两个视角。
- `blend`：镜头在两个视角之间按滚动进度插值；原 `camTarget` 的主体改名为 `targetFor`。
- `pinEnds`：聚焦输入或输出时，把该段的通道标签钉在各自光流上（`placeLabels` 里的一个分支）。

`Nebula.tsx` 是把 `scene.ts` 合成阶段画背景的着色器单独取出来，给运营平台登录页当背景。

主仓库的引擎仪表盘更新后，这里需要手动同步。更干净的做法是把上面四个属性并回 `src/operations/engine-stage/scene.ts`，然后官网直接引用原文件，删掉这份副本。
