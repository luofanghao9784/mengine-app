import { readFile, writeFile } from 'node:fs/promises';
const root = new URL('../../', import.meta.url);
const contract = JSON.parse(await readFile(new URL('engine/src/runtime/briefing-contract.json', root), 'utf8'));
const topic = await readFile(new URL('engine/src/runtime/briefing-topic-strategy.ts', root), 'utf8');
const version = topic.match(/BRIEFING_TOPIC_STRATEGY_VERSION = '([^']+)'/)[1];
const strategy = topic.match(/BRIEFING_TOPIC_STRATEGY = `([^`]+)`/)[1].replace('${BRIEFING_TOPIC_STRATEGY_VERSION}', version);
const text = `# 画报生成规则审阅稿

本稿用于确认当前共用的画报表达与选题规则。表达版本 **${contract.version}**，选题版本 **${version}**。2026-10-26 补充真实零值业务基线、空数据与NULL边界，以及交付后采用平台核对事实内容、辅助计算完整绑定与独立期间展示的要求。保留此前确认的卡面与详情结构对应、完整行预览与标准尺寸补位、岗位决策优先、关联数据找具体问题、直白表达与个案边界、事实去重、业务主题分散、证据不足少生成、待核对事项优先、资讯分区、序号单一、正文与执行记录分离、真实配图及统一详情分类。开发侧规范与历史卡片适配边界见 [画报内容与展示规范](画报内容与展示规范.md)。本稿为自动导出的共用规则，不能替代具体任务的规则快照。

## 规则如何生效

唯一表达来源是 [briefing-contract.json](../../engine/src/runtime/briefing-contract.json)。运行时任务提示词和交付工具引用它；API 构建打包同一文件，首次部署制作入口在 prepare 阶段返回并保存规则。修改本稿不改变程序规则。更新源文件后运行 \`node scripts/docs/export-briefing-rules.mjs\` 同步本稿；后端及引擎需重新构建并重启才采用新版。

生成流程为：读取接收人岗位目标、获准资料与近期画报 → 选题和整批规划 → 读取任务依据并取得必要计算回执 → 按规则撰写 → 服务端校验权限、版本、类型、证据与交付状态 → 展示正文和依据。规则约束表达，权限、计算和交付仍由代码控制。

总部、企业、个人保存的表达偏好也会以任务快照叠加；冲突时当前用户明确要求优先，其后为个人、企业、总部，同层画报专用规则优先于通用规则。偏好不能覆盖事实、证据和权限。本稿展示共用基线，不冒充某次任务的个性化规则快照。

## 共用表达规则全文

${contract.rules.split('\n').join('\n\n')}

## 共用选题策略全文

${strategy}

## 本次既有卡片处理

用户指定段落从正文移入“查看依据 → 详细执行记录”，原始产物与执行回执保持不变。仅迁移明确指定的旧段落，不按“回执”“缺少”等关键词自动隐藏其他业务限制。后续生成按新增规则约束，真实模型稳定遵循效果仍需实测；规则变更不等于模型验收通过。
`;
await writeFile(new URL('docs/技术/画报生成规则-审阅稿.md', root), text);
