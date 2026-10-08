import type { TelemetryChannelCode } from '../../../contracts/public-api/engine-telemetry';

export const workBusinesses: {
  id: string;
  name: string;
  angle: number;
  codes: TelemetryChannelCode[];
  description: string;
}[] = [
  {
    id: 'conversation',
    name: '会话与画报',
    angle: 0,
    codes: ['TASK'],
    description: '员工会话与画报任务的执行状态。',
  },
  {
    id: 'company',
    name: '企业分析',
    angle: 2.35,
    codes: ['COMPANY'],
    description: '企业信息分析任务的执行状态。',
  },
  {
    id: 'experience',
    name: '经验处理',
    angle: 4.3,
    codes: ['EXPERIENCE', 'GENERALIZATION', 'GENERAL_ADJUSTMENT'],
    description: '汇总经验提炼与核验、通用经验清洗和总库调整核验。',
  },
];
