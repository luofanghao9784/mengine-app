import type { SystemInfo } from '../../contracts/public-api/system.ts';
import type { MethodSelection } from '../../contracts/public-api/methods.ts';
/** The probe describes runtime configuration, never model/business outcomes. */
export function runtimePresentation(info: SystemInfo) {
  const descriptions = {
    'contract-only': {
      title: '任务运行能力尚未启用',
      detail: '当前引擎仅提供契约响应。不能据此确认资料检索或 AI 分析可执行。',
    },
    'local-retrieval': {
      title: '资料检索运行模式',
      detail: '当前引擎报告可检索获准资料，未提供主模型分析能力。',
    },
    'agent-verification': {
      title: '本地合成验证模式',
      detail: '当前引擎可运行资料检索与合成模型流程；这不是真实模型能力或业务效果验证。',
    },
    'agent-live': {
      title: '正式模型运行模式已配置',
      detail:
        '当前引擎报告资料检索与模型任务能力。具体任务仍核对当前授权、输入和平台开关，结果以实际回执为准。',
    },
  };
  return {
    ...descriptions[info.engine.runtimeMode],
    engineVersion: info.engine.engineVersion,
    source: '当前引擎服务响应',
    capabilities: info.engine.capabilities.map((c) =>
      c === 'source-lookup' ? '资料检索' : c === 'agent-task' ? '模型任务' : c,
    ),
  };
}
export function effectiveMethodPresentation(selection: MethodSelection) {
  return {
    source:
      selection.effective.scope === 'WORKSPACE'
        ? '空间明确采用'
        : selection.effective.scope === 'TENANT'
          ? '企业默认采用'
          : '发布版本内建默认',
    versionId: selection.effective.versionId,
    adoptionRevision: selection.effective.adoptionRevision,
    configurationSha: selection.effective.configurationSha,
    configuration: selection.configuration,
    stoppedLocalAdoption: selection.adoption?.status === 'STOPPED',
    canAdopt: selection.canAdopt,
  };
}
