import { randomUUID } from "node:crypto";
import { Store, digest } from "./store.js";
import { now, scan, type User, type Doc } from "./domain.js";
export const DEMO_PASSWORD = "Mengine-Demo-2026!";
export function seed(store: Store) {
  if (store.tenant("mengine-demo")) return;
  const tenantId = "mengine-demo";
  store.db
    .prepare("INSERT INTO tenants VALUES(?,?,?)")
    .run(tenantId, "梦核科技", now());
  store.db
    .prepare("INSERT INTO tenants VALUES(?,?,?)")
    .run("isolated-client", "独立客户空间", now());
  const users: User[] = [
    {
      id: "u-steward",
      tenantId,
      name: "罗方豪",
      email: "steward@mengine.demo",
      department: "技术研发",
      role: "steward",
      clearance: 3,
      active: true,
    },
    {
      id: "u-admin",
      tenantId,
      name: "林云",
      email: "admin@mengine.demo",
      department: "企业管理",
      role: "admin",
      clearance: 3,
      active: true,
    },
    {
      id: "u-engineer",
      tenantId,
      name: "曹鸿健",
      email: "engineer@mengine.demo",
      department: "技术研发",
      role: "member",
      clearance: 1,
      active: true,
    },
    {
      id: "u-hr",
      tenantId,
      name: "吴端阳",
      email: "hr@mengine.demo",
      department: "人力资源",
      role: "manager",
      clearance: 3,
      active: true,
    },
    {
      id: "u-auditor",
      tenantId,
      name: "沈砚",
      email: "auditor@mengine.demo",
      department: "合规审计",
      role: "auditor",
      clearance: 1,
      active: true,
    },
    {
      id: "u-external",
      tenantId: "isolated-client",
      name: "其他客户",
      email: "external@mengine.demo",
      department: "技术研发",
      role: "admin",
      clearance: 3,
      active: true,
    },
  ];
  users.forEach((u) => store.addUser(u, DEMO_PASSWORD));
  const fixtures = [
    [
      "Mengine 引擎架构与技术白皮书",
      "技术研发",
      1,
      "department",
      "架构,核心引擎",
      "Mengine 通过统一调度层管理业务任务，执行层隔离计算与存储资源。\n\n数据进入引擎前完成租户标识校验、格式校验和数据分级。查询在授权范围内执行，资料管理员不自动获得内容读取权限。\n\n发布流程分为开发验证、预发布回归、责任人审核和灰度发布。故障恢复目标为根据最近一次验证快照重建索引，原始文档持续保留。",
    ],
    [
      "企业数据分类分级管理规范",
      "合规审计",
      1,
      "organization",
      "数据治理,合规",
      "企业数据划分为公开、企业内部、机密、严格受限四个等级。访问由企业、岗位职责、部门范围及显式授权共同决定。\n\n公开资料仍限于所属企业登录用户。机密资料需要匹配内容授权与安全级别。任何岗位不得跨企业检索或导出资料。\n\n治理负责人每季度复核权限，敏感内容进入隔离区，审核通过后发布。Agent 提炼内容不改变资料权限，权限调整必须形成审批记录。",
    ],
    [
      "API 网关接入与鉴权指南",
      "技术研发",
      1,
      "department",
      "API,开发指南",
      "API 网关为每次调用生成请求标识，验证身份与企业上下文后进入业务服务。访问凭证不得放入客户端公开变量。\n\n服务端负责资料列表、正文读取、搜索召回、引用跳转和写入操作的授权判断。API 返回 404 隐藏不可见资料，禁止通过文件 ID 枚举其他企业数据。\n\n接口故障先检查调用权限与参数，再检查服务状态。重试需要使用相同的幂等标识。",
    ],
    [
      "2026 Q4 产品路线与交付计划",
      "产品设计",
      1,
      "organization",
      "产品规划,交付",
      "第四季度围绕企业知识沉淀、权限治理和智能协作推进。第一阶段完成资料接入与知识提炼，第二阶段强化岗位授权与质量复核，第三阶段优化使用体验。\n\n每个交付项必须指定责任人、验收标准及回滚方案。跨部门协作通过授权共享进行，审批通过前不能直接扩大资料的可见范围。",
    ],
    [
      "客户成功服务标准与 SLA",
      "客户成功",
      1,
      "organization",
      "客户服务,SLA",
      "客户成功团队负责企业接入辅导、工单响应和知识反馈。紧急故障进入值班响应流程，一般问题进入工作日处理队列。\n\n服务记录不得包含未脱敏的客户账号与个人资料。复盘结论写入经验库，由负责人复核后发布。",
    ],
    [
      "研发环境部署与故障排查手册",
      "技术研发",
      1,
      "department",
      "运维,部署",
      "开发环境、预发布环境和生产环境分别管理配置。部署前检查数据库迁移、存储目录权限和模型连接状态。\n\n故障排查先定位日志中的请求标识，不记录访问密钥与原始敏感正文。回滚时同时核对知识版本和索引版本，避免引用已撤销的资料。",
    ],
    [
      "员工薪酬与绩效核定方案",
      "人力资源",
      3,
      "private",
      "人事,严格受限",
      "薪酬与绩效数据仅由获得明确授权的人力资源岗位处理。绩效校准需要业务负责人和人力资源负责人共同复核。\n\n此资料属于严格受限范围，企业管理员和其他部门均不能默认查看正文、摘要或通过 Agent 检索。",
    ],
    [
      "资料生命周期与归档操作规程",
      "合规审计",
      1,
      "organization",
      "生命周期,归档",
      "资料生命周期包括接入、检查、发布、复核和归档。归档资料退出问答召回，审批与审计记录保留。\n\n内容更新产生新版本，审批必须校验当前文档与权限版本。过期方案不能直接执行，必须基于最新资料重新生成。",
    ],
    [
      "引擎性能优化实践与复盘",
      "技术研发",
      2,
      "department",
      "经验沉淀,性能",
      "性能优化先以真实负载建立基线，再识别查询延迟与资源消耗。索引拆分应保持企业隔离与来源可追溯。\n\n检索质量需使用独立业务题库衡量，单纯增大引用数量不能证明排序质量提升。上线后持续观察延迟、错误率和降级率。",
    ],
    [
      "历史客户联络资料待复核",
      "客户成功",
      2,
      "private",
      "",
      "待复核的客户联系记录包含手机号 13800138000。此样例用于演示敏感信息检测与隔离，发布前必须完成脱敏处理。",
    ],
    [
      "新员工入职知识导航",
      "人力资源",
      1,
      "organization",
      "入职,知识导航",
      "欢迎加入梦核科技。请先了解企业数据分类规范和知识库使用方式。每个岗位看到的资料基于业务职责授权。\n\n需要跨部门内容时应发起访问申请，不应通过他人账号查看。Agent 可以辅助提炼与整理，但执行修改前需要用户确认。",
    ],
    [
      "知识资产质量检查清单",
      "技术研发",
      1,
      "department",
      "质量管理,知识资产",
      "知识资产需具备清晰标题、业务标签、责任部门、密级和复核日期。清理重复资料前确认来源和使用范围。\n\n有效知识应能定位到原始证据。文件后半部分的内容同样需要被索引，不能仅用前几个段落替代全文检索。",
    ],
  ];
  fixtures.forEach((f, i) => {
    const [title, department, classification, audience, tagString, content] =
      f as [string, string, number, Doc["audience"], string, string];
    const tags = tagString.split(",").filter(Boolean);
    const reviewAt = i === 5 ? "2026-09-01" : "2027-01-10";
    const report = scan(content, tags, reviewAt);
    const d: Doc = {
      id: `doc-${i + 1}`,
      tenantId,
      title,
      kind: "md",
      department,
      ownerId: i === 6 ? "u-hr" : "u-steward",
      uploadedBy: { id: users[i === 6 ? 3 : 0].id, name: users[i === 6 ? 3 : 0].name },
      classification,
      audience,
      grants: [],
      tags,
      status: i === 9 ? "quarantined" : "ready",
      version: 1,
      policyVersion: 1,
      content,
      summary: content.split("\n")[0],
      sha: digest(content),
      originalPath: "",
      createdAt: new Date(Date.now() - (i + 1) * 86400000).toISOString(),
      updatedAt: new Date(Date.now() - i * 3600000).toISOString(),
      reviewAt,
      quality: report.quality,
      issues: report.issues,
      error: null,
    };
    store.saveDoc(d);
    store.version(d);
  });
  store.audit(
    users[0],
    "workspace.initialized",
    "梦核科技",
    "本地演示空间初始化，示例资料与真实上传分开标识",
  );
}
export function bootstrap(
  store: Store,
  name: string,
  email: string,
  password: string,
) {
  const tenantId = randomUUID();
  const user: User = {
    id: randomUUID(),
    tenantId,
    name: "企业管理员",
    email,
    department: "企业管理",
    role: "admin",
    clearance: 3,
    active: true,
  };
  store.db.transaction(() => {
    store.db
      .prepare("INSERT INTO tenants VALUES(?,?,?)")
      .run(tenantId, name, now());
    store.addUser(user, password);
    store.audit(user, "tenant.created", name, "企业初始化");
  })();
  return user;
}
