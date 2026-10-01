import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveMethodPresentation, runtimePresentation } from '../src/governance/work-configuration.ts';
import type { MethodSelection } from '../contracts/public-api/methods.ts';
import type { SystemInfo } from '../contracts/public-api/system.ts';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const info = (mode: SystemInfo['engine']['runtimeMode']): SystemInfo => ({
  contractVersion: '1.0',
  service: 'dreamcore-platform',
  stage: 'foundation',
  dataSource: 'live',
  engine: {
    contractVersion: '1.0',
    engineVersion: '0.12.0',
    runtimeMode: mode,
    capabilities:
      mode === 'contract-only'
        ? []
        : mode === 'local-retrieval'
          ? ['source-lookup']
          : ['source-lookup', 'agent-task'],
  },
  integrations: {
    harness:
      mode === 'agent-live'
        ? 'configured'
        : mode === 'agent-verification'
          ? 'verification'
          : 'not-configured',
    weknora: 'not-configured',
    jev: 'not-configured',
  },
});
test('live HTTP data with a verification runtime remains synthetic verification', () => {
  const result = runtimePresentation(info('agent-verification'));
  assert.equal(result.title, '本地合成验证模式');
  assert.match(result.detail, /不是真实模型能力或业务效果验证/);
  assert.equal(result.engineVersion, '0.12.0');
});
test('contract-only and retrieval-only responses do not imply a main model is available', () => {
  assert.deepEqual(runtimePresentation(info('contract-only')).capabilities, []);
  assert.equal(runtimePresentation(info('contract-only')).title, '任务运行能力尚未启用');
  assert.deepEqual(runtimePresentation(info('local-retrieval')).capabilities, ['资料检索']);
  assert.match(runtimePresentation(info('local-retrieval')).detail, /未提供主模型分析/);
  assert.match(runtimePresentation(info('agent-live')).detail, /平台开关/);
});
test('stopped workspace adoption displays actual tenant fallback, not the obsolete selected version', () => {
  const value: MethodSelection = {
    canAdopt: false,
    configuration: { relevanceWeight: 7, recencyWeight: 2, importanceWeight: 1 },
    effective: {
      scope: 'TENANT',
      versionId: id(3),
      workspaceId: null,
      adoptionRevision: 6,
      configurationSha: 'effective-current-hash',
    },
    adoption: {
      id: id(5),
      tenantId: id(1),
      workspaceId: id(2),
      revision: 9,
      status: 'STOPPED',
      versionId: id(4),
      effectiveFallback: 'TENANT_THEN_BUILTIN',
      history: [],
    },
    adoptedVersion: {
      id: id(4),
      familyId: id(6),
      number: 3,
      baseVersion: null,
      configuration: { relevanceWeight: 1, recencyWeight: 1, importanceWeight: 8 },
      configurationSha: 'old-space-hash',
      compatibility: 'ranking-v1',
      rationale: '原来空间方法',
      published: true,
      createdAt: '2026-10-01T00:00:00Z',
    },
  };
  const actual = effectiveMethodPresentation(value);
  assert.equal(actual.source, '企业默认采用');
  assert.equal(actual.versionId, id(3));
  assert.equal(actual.adoptionRevision, 6);
  assert.equal(actual.configurationSha, 'effective-current-hash');
  assert.deepEqual(actual.configuration, value.configuration);
  assert.ok(actual.stoppedLocalAdoption);
  assert.equal(actual.canAdopt, false);
});
