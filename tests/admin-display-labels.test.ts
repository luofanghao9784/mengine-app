import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classificationLabel,
  actionLabel,
  actorLabel,
  auditDetail,
  displayText,
  fieldLabel,
  isDeploymentIdentifier,
  recordLabel,
  settingsLabel,
  timeZoneLabel,
  versionLabel,
} from '../src/admin/display-labels.ts';

test('display whitelist maps approved fields, categories, stages and actions', () => {
  assert.equal(recordLabel('funnel_stage'), '线索漏斗阶段');
  assert.equal(recordLabel('internal_material'), '内部资料');
  for (const [code, label] of Object.entries({
    INPUT: '输入',
    PROCESS: '处理',
    OUTPUT: '输出',
    ENGINE: '引擎',
    EVOLUTION: '自进化',
    EVOLVE: '自进化',
  }))
    assert.equal(recordLabel(code), label);
  assert.equal(actionLabel('COLLECTION_NOW'), '立即更新数据');
  assert.equal(actionLabel('deployment.governance.applied'), '更新数据口径');
  assert.equal(recordLabel('Codex-CT027-B'), '总部整理');
  assert.equal(displayText('来源 Codex-CT027-B（部署治理）'), '总部整理');
  assert.equal(displayText('synth_demo.sqlite 字段说明 v1'), '演示数据字段说明 · 第 1 版');
});

test('unknown values and inherited object keys never fall back to original codes', () => {
  for (const code of [
    'NEW_CODE',
    'future.action',
    'unknown-category',
    'constructor',
    'toString',
    '__proto__',
    '',
    undefined,
  ]) {
    assert.equal(recordLabel(code), '其他记录');
    assert.equal(actionLabel(code), '其他操作');
  }
  assert.equal(displayText('尚待 FUTURE_CODE 检查'), '尚待 其他记录 检查');
  assert.equal(fieldLabel('unapproved_column'), '其他记录');
});

test('metadata title takes priority; empty title uses the dictionary', () => {
  assert.equal(recordLabel('funnel_stage', { title: '业务确认的阶段' }), '业务确认的阶段');
  assert.equal(actionLabel('COLLECTION_NOW', { title: '本次数据更新' }), '本次数据更新');
  assert.equal(recordLabel('funnel_stage', { title: ' ' }), '线索漏斗阶段');
  assert.equal(fieldLabel('unapproved_column', '已确认字段'), '已确认字段');
});

test('audit actors reuse the shared identity labels and preserve full display names', () => {
  assert.equal(actorLabel('张三', { role: 'TENANT_ADMIN', owner: true }), '张三（企业负责人）');
  assert.equal(
    actorLabel('张三', { role: 'TENANT_ADMIN', canConfigure: false }),
    '张三（企业管理员（权限受限））',
  );
  assert.equal(actorLabel('张三', { role: 'MEMBER', canMaintain: true }), '张三（成员 · 可维护空间）');
  assert.equal(actorLabel('李四', { platformAdmin: true }), '李四（总部管理员）');
  assert.equal(actorLabel('王五', { role: 'FUTURE_ROLE' }), '王五');
  assert.equal(actorLabel('系统'), '系统');
  assert.equal(actorLabel('SYSTEM', { owner: true }), '系统');
  assert.equal(actorLabel('预览企业A 负责人（TENANT_ADMIN+owner）'), '预览企业A 负责人（企业负责人）');
  assert.equal(actorLabel('完整 姓名（FUTURE_ROLE）'), '完整 姓名');
  assert.equal(actorLabel('  张三 · 财务  ', { role: 'MEMBER' }), '  张三 · 财务  （成员）');
  assert.equal(actorLabel('张三（Alex）'), '张三（Alex）');
});

test('versions, settings, timezone and legacy prose use approved Chinese copy', () => {
  assert.equal(versionLabel(1), '第 1 版');
  assert.equal(versionLabel('v2'), '第 2 版');
  assert.equal(versionLabel('opaque-hash'), '尚无版本');
  assert.equal(displayText('来源 v2 · 知识 v1'), '来源第 2 版 · 知识第 1 版');
  assert.equal(settingsLabel(0), '尚未修改过设置，按企业分别保存。');
  assert.equal(settingsLabel(3), '第 3 版设置，按企业分别保存。');
  assert.equal(timeZoneLabel('Asia/Shanghai'), '北京时间');
  assert.equal(timeZoneLabel('Unlisted/Zone'), '其他记录');
  assert.equal(displayText('专业 DLP 检查'), '专业防泄密检查');
  assert.equal(displayText('OCR 文字需核对原件'), '识别出的文字需核对原件');
});

test('deployment audit conceals package ID and preserves the checked count', () => {
  assert.equal(
    auditDetail('deployment.governance.applied', '部署 ct027-b-synth-demo-v1；全量检查 26 条；保留异常隔离'),
    '检查 26 条，异常记录已隔离',
  );
  assert.equal(auditDetail('deployment.governance.applied', '检查 0 条'), '检查 0 条，异常记录已隔离');
  assert.equal(auditDetail('deployment.governance.applied', 'NEW_DETAIL'), '异常记录已隔离');
  assert.equal(isDeploymentIdentifier('部署 ct027-b-synth-demo-v1'), true);
  assert.equal(isDeploymentIdentifier('部署 next-package-2；检查 10 条'), true);
  assert.equal(isDeploymentIdentifier('总部整理'), false);
  assert.equal(isDeploymentIdentifier(['部署', 'ct027-b-synth-demo-v1', '']), true);
  assert.equal(classificationLabel(1), '企业内部');
  assert.equal(classificationLabel(99), '其他记录');
});
