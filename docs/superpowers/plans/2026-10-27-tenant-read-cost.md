# 多企业锁与读取成本实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. 当前会话直接实现，最终独立审查。

**Goal:** 企业之间不共用 Scene 锁，单条详情与重复指纹读取工作量收敛。
**Architecture:** 企业局部读写锁；现有授权查询支持目标过滤；确定性指纹复用版本证据收据。
**Tech Stack:** Java 21 / Spring / PostgreSQL。
**Spec:** ../specs/2026-10-27-tenant-read-cost-design.md

## Global Constraints
- 不操作生产，不缓存权限，不改任务配额与消费者。
- 指纹算法保持原值；新迁移 V189 仅扩展证据种类。

## Review Focus
- 引用回收不能导致同一企业出现两把并存锁。
- 嵌套同步、异常、撤权后仍满足同企业互斥。
- 原始内容未读时，授权及 scrubbed 状态仍逐次校验。
- 元数据变化必须让指纹缓存失效且不改变历史算法。
- 详情查询保持资料入库、生命周期、空间和对象权限语义。

## Task 1：Scene 企业锁
- [x] 新增慢写跨企业读写测试，观察旧实现超时失败。
- [x] SceneService.locked(UUID tenant,boolean read,Supplier<T>) 按企业维护可回收公平读写锁。
- [x] 运行 SceneDispatchConcurrencyTest，包括现有撤权及同企业写互斥。

## Task 2：版本指纹
- [x] 真实 PostgreSQL 复现指纹同键并发重复计算，新增 CONTENT_FINGERPRINT 证据种类；覆盖两事务 REPEATABLE_READ 冷缺失不写冲突收据。
- [x] DatasetContentFingerprint.key(UUID actor,UUID tenant,UUID dataset,UUID snapshot) 保留授权、原指纹算法与元数据失效；BriefingGenerationService 接入。
- [x] 验证旧值一致、无原始行读取的缓存命中、跨企业/撤权/清理/元数据变化及并发。

## Task 3：详情读取
- [x] 新增详情不读取无关目录测试，观察旧实现失败。
- [x] 现有 CollectionService.datasets 与 MaterialService.list 增加内部目标过滤；NativeFoundationService 下推 target 并跳过另一目录。
- [x] 真实权限和资料详情回归；简报、会话、Scene、版本证据相关套件，构建并独立审查。
- [x] 更新 PR #205 最终范围和验证证据，保持未合并未部署。

## 执行结果

- Scene 跨企业慢写、全目录详情读取、重复证据计算均已观察失败后修复。
- 独立审查指出 RR 并发验收缺口；两事务用例复现 40001 后通过。实现只对 CONTENT_FINGERPRINT 的 RC 冷缺失合并计算，RR 冷缺失按自身快照计算且不写收据；未改变其他证据并发行为。
- 434 项相关测试全通过；后端打包与前端构建通过，差异检查通过。跨套件遗留解析任务由夹具按自己企业清理，未改业务规则。
- 没有新增多实例一致性保证；同企业远程调用仍保持互斥，避免削弱现有桥接权限语义。生产未操作。
