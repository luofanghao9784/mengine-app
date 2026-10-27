# 自动简报空闲退避实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. 本会话直接实现，最后独立审查。

**Goal:** 降低无工作时的重复计算，保留多企业任务吞吐。
**Architecture:** 策略独立退避，活跃批次旁路，按企业交错候选与按轮推进。
**Tech Stack:** Java 21 / Spring / PostgreSQL。
**Spec:** ../specs/2026-10-27-briefing-idle-design.md

## Global Constraints
- 最长 60 秒空闲退避；生产环境不变。
- 不缓存权限，不改变消费端、配额或执行租约。

## Review Focus
- 活跃批次不能被空闲时间挡住。
- 单企业策略不能占满所有候选。
- 并发推进必须持有现有锁，不重复派发。
- 等待状态不得被误判成持续进展。
- 直接业务 tick 与后台调度入口保持兼容。

## Task 1：后台调度收敛
- [x] 在 BriefingGenerationIntegrationTest 加入空闲重复检查、多企业公平测试，运行并观察失败。
- [x] 新增 migration-common/V188__briefing_idle_scheduling.sql；修改 BriefingGenerationService，新增 transactional boolean advance(UUID id)，按策略保存退避，活跃批次旁路；candidates 按企业交错。
- [x] 修改 BriefingGenerationWorker 为按轮交错 advance，仅有进展才再推进，最多五轮。
- [x] 新增退避上限、手动任务派发消费、撤权回归；运行相关简报集成测试及构建。
- [x] 独立审查；更新变更记录，提交并创建 PR，不合并部署。

执行记录：Issue #204 已指派本人；基于 main 9b36b1e5。复用当前独立克隆及任务分支，不新增 worktree。用户已授权按方案实现，沿用既有确认，不重复索取审批。

完成证据：两个回归 RED→GREEN；266 项相关测试与后端打包通过，前端/引擎构建通过；独立审查无阻塞项。调度检查范围仍为最多 20 候选/轮；不承诺过载时 60 秒完成处理。未部署。
