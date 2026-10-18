#!/usr/bin/env python3
"""Generate standalone open-source component assessment; never edit application sources."""
from pathlib import Path
import json, html, os
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
metadata={r['repo']:r for r in json.loads((HERE/'opensource-sources.json').read_text())}
items=[]
def add(id,name,repo,license,priority,kind,flows,code,current,replace,retain,approach,effort,gate,license_note=''):
    items.append(dict(id=id,name=name,repo=repo,url='https://github.com/'+repo,license=license,priority=priority,kind=kind,flows=flows.split(','),code=code.split('|'),current=current,replace=replace,retain=retain,approach=approach,effort=effort,gate=gate,licenseNote=license_note,sha=metadata[repo].get('sha',''),commitDate=metadata[repo].get('commitDate','')))
add('OSS01','Docling','docling-project/docling','MIT；模型单独许可','P1','局部替换','F01,F04,F08,O02',
'workers/parser/parse.py|apps/api/src/main/java/com/dreamcore/workspace/knowledge/DocumentParser.java',
'平台通过 DocumentParser 调用 Python 解析器；PDF 使用文字提取和 OCR，复杂版式能力有限。',
'复杂 PDF 的布局、阅读顺序、表格结构和扫描件解析；可以只替换 PDF 分支。',
'上传、原件与版本、解析任务、状态、权限复核和固定引用；CSV/XLSX 原值与公式缓存语义先保留。',
'独立受限进程或服务接入 DocumentParser，将结构化结果适配回 chunks/locator/status/warnings；新 parserVersion，不覆盖旧批次。',
'中：模型资源、进程隔离和定位符适配',
'用获准中文扫描件、跨页表格及混合版式对照原解析器；检查页码定位、表格值、超时、取消和撤权。',
'代码 MIT 不等于全部模型同许可；按实际选用模型与镜像核验。')
add('OSS02','WeKnora','Tencent/WeKnora','主项目 MIT；第三方逐项','P1','局部替换','F01,F04,F06,F08,O01,O02',
'apps/api/src/main/java/com/dreamcore/workspace/knowledge/KnowledgeService.java|docs/技术/M3-A1本地解析与WeKnora接入边界.md',
'已实现 WeKnora v0.8.3 可选适配、索引队列、权限复核和删除检查；HTTP 契约与隔离测试通过，真实服务待联调。',
'索引、语义与混合召回、重排等检索服务；其 Wiki 编译可另作知识草稿生成器候选。',
'本系统企业/空间/文件版本映射、已授权来源集合、引用身份、Wiki 发布和来源撤回。',
'通过服务端适配器接检索 API，不嵌入其完整前端。先发非空获准版本范围，结果映射后再校验；本轮固定 v0.8.3 契约，默认关闭，真实召回效果待验。',
'中至大：索引映射、模型服务和双系统生命周期',
'同一批问题与现有检索盲测；跨企业、空授权集合、撤权、删除、旧版本、索引重建必须不泄漏。',
'只选择所需组件；模型与可选存储的许可和运维成本另算。')
add('OSS03','pgvector','pgvector/pgvector','PostgreSQL License','P1','补强 / 替代检索内核','F01,F04,F06,F08,O01,O02',
'apps/api/src/main/java/com/dreamcore/workspace/knowledge/KnowledgeService.java',
'已有 PostgreSQL 保存资料片段，当前关键词匹配使用 strpos(lower(...))。',
'替换检索中的向量近邻计算和索引部分，复用现有数据库；是 WeKnora 服务路线的轻量备选。',
'嵌入生成、分块、重排、中文关键词策略、授权 SQL、引用、索引失效与更新仍需开发。',
'在片段版本旁建立向量映射，查询前限定企业和许可范围，返回前重查；优先比较同库方案与独立检索服务，首轮二选一。',
'中：运维增量较小，但检索编排仍需自研',
'按真实允许集合评测召回率、过滤后结果不足、中文查询和索引更新；不把向量距离当正确答案。')
add('OSS04','dlt','dlt-hub/dlt','Apache-2.0','P2','局部替换','F01,F03,F04,O03',
'apps/api/src/main/java/com/dreamcore/workspace/collection/CollectionAdapter.java|integrations/mengine-wiki/apps/api/src/server.ts',
'已存在只读数据库适配器、定时采集和平台快照协议；不是从零搭采集系统。',
'新增连接器时的读取、分页、增量游标、规范化及落地流水线。',
'获准数据范围、源库只读账号、字段业务口径、平台数据集 ID、快照回执及退出清理。',
'包装为受控 Python 采集执行器，先落任务临时区，再返回 CollectionAdapter 协议；不要让它直接维护平台业务表。',
'中：跨语言适配与持久游标',
'验证重复采集不重复入库、游标回滚、空数据、字段变化和撤销连接；新增来源才优先考虑。')
add('OSS05','Great Expectations（GX Core）','fivetran/great_expectations','Apache-2.0','P2','局部替换','F04,O03',
'integrations/mengine-wiki/apps/api/src/structured-governance.ts|integrations/mengine-wiki/apps/api/src/deployment-governance.ts',
'已有字段必填、格式、唯一性、关系及治理问题处理逻辑。',
'可复用规则执行、数据质量断言与验证结果；适合规则类型和数量持续增长。',
'字段经营含义、问题审批、隔离/复检状态、治理职责、来源版本和 AI 研判责任。',
'把选定的确定性规则送入 GX，标准化输出为当前治理发现；不从其成功结果直接授予业务权限。',
'中：Python 服务与现有规则语义对齐',
'同一快照比较原规则与新规则结果；未覆盖的业务断言不能删除。现有少量规则够用时不替换。')
add('OSS06','DuckDB','duckdb/duckdb','MIT','P2','局部替换','F04,F07,O03',
'apps/api/src/main/java/com/dreamcore/workspace/analysis/governed/FusionCalculator.java|apps/api/src/main/java/com/dreamcore/workspace/scene/GovernedDatasetCalculationService.java',
'固定指标与融合计划在自研计算器中执行，显式检查金额精度、聚合粒度和多对一关系。',
'大快照的分组、过滤、聚合和连接执行内核；不替换业务 PostgreSQL。',
'指标定义、单位、版本、允许的运算计划、多源授权交集、计算前后撤权检查和回执。',
'由可信编译器把已发布计划转换成固定 SQL，仅挂载获准快照；禁止模型任意 SQL、扩展安装、联网或文件读取。',
'中至大：查询编译与精度/空值语义回归',
'对照金额小数、空值、重复维表键、不同时间粒度和行范围；同结果、同来源、同拒绝条件后再切换。')
add('OSS07','Langfuse','langfuse/langfuse','核心 MIT；ee 另行许可','P1','补强 / 局部替换运维','F01,F03,F06,O04',
'engine/src/runtime/metered-model.ts|src/admin/prototype/runtime.ts',
'已有任务回执、模型尝试计量、企业遥测和总台用量页面。',
'模型/工具调用链追踪、评测样本、提示词实验与失败诊断，可减少自建调试台工作。',
'产品内任务状态、客户可见用量、计费口径、企业隔离、未知结果与业务审计。',
'已接入可选元数据观测：taskId/attemptId、时延、状态和数值用量；不传正文、提示词、工具参数、结果或原始错误。实际 Langfuse 实例待联调。',
'中：独立服务和数据生命周期维护',
'验证一轮任务各调用可串联；用量与业务回执能核对，遥测失败不阻断任务；日志内容与删除策略受控。',
'ee 目录不属核心 MIT，项目级治理等功能须按当日官方版本边界核验。')
add('OSS08','Apache ECharts','apache/echarts','Apache-2.0','P2','局部替换组件','F07,O06',
'src/briefing-live/DetailChart.tsx|src/briefing-live/chart-presentation.ts',
'画报已有自研图表与视图切换，图表只展示服务端核实数据。',
'新增复杂图表的坐标轴、提示、缩放、图例和部分绘图代码；可仅用于详情图。',
'五类画报、内容选择、卡片样式、单位与时间口径、精确值、来源提示和关注板。',
'把现有 BriefingDocument 的已校验数据适配为图表配置；保留原卡面，避免为换库重做产品视觉。',
'小至中：前端适配与图表口径检查',
'检查空值、负数、大数、精确金额、手机布局和无障碍说明；不能让图表自行重算业务口径。')
add('OSS09','Tiptap 开源编辑器','ueberdosis/tiptap','核心 MIT；Pro/云服务另计','P2','局部替换组件','F08,O06',
'src/documents/DocumentCard.tsx|src/documents/drafts.ts',
'个人文稿正文当前使用 textarea，版本与发布流程已存在。',
'仅替换编辑输入区域，提供结构化富文本、表格和基础编辑交互。',
'私人归属、版本冲突、保存、导出、固定引用和明确共享发布。',
'先约定可接受的文档 schema 与纯文本/现有正文转换，增量嵌入一个编辑区域；实时多人协作不是本轮自动新增范围。',
'中：数据格式兼容、导出与粘贴清理',
'旧文稿往返不丢内容，保存冲突不覆盖，导出与引用可复核；确有富文本需求再上。',
'Pro 扩展需要订阅；不能把其批注、转换、AI、协作等整套能力当作核心免费附送。')
add('OSS10','PptxGenJS','gitbrent/PptxGenJS','MIT','已有','已采用，保留','F08,O01,O06',
'engine/package.json|engine/src/runtime/presentation-render.ts',
'当前明确依赖 pptxgenjs 4.0.1，固定渲染器直接调用此库。',
'已经承担 PPTX 文件生成，不存在再次用它替换一次的问题。',
'内容来源、大纲、用户确认、页数与主题约束、文件校验和下载授权。',
'继续复用当前固定版本；仅在新模板/渲染缺陷需求下扩展配方或评估版本升级。',
'无替换迁移；后续模板工作按需',
'新模板检查文本溢出、中文字体、页序与下载文件一致性。当前库不能自动带来在线 PPT 编辑器。')
add('OSS11','Keycloak','keycloak/keycloak','Apache-2.0','P3','条件性局部替换','F02,F05,O05',
'src/identity/AccessApp.tsx|apps/api/src/main/java/com/dreamcore/workspace/identity/PlatformIdentity.java',
'已有统一账号记录、总台独立会话、企业/员工业务会话及邀请流程。',
'企业客户需要时，承担 OIDC/SAML 单点登录、凭据验证和身份联邦。',
'三端资格、首位负责人激活、企业成员与空间、独立总台会话、支持访问和服务暂停。',
'先添加外部身份提供方适配，把身份映射到现有账号，不把 realm/group 直接等同于业务企业/职责。',
'大：账号映射与会话迁移',
'防止同邮箱错误合并身份；验证退出、停用、邀请接受和总台/客户会话隔离。没有 SSO 需求时保留现状。')
add('OSS12','OpenFGA','openfga/openfga','Apache-2.0','P3','条件性局部替换','F05,O05',
'apps/api/src/main/java/com/dreamcore/workspace/knowledge/KnowledgeService.java|integrations/mengine-wiki/apps/api/src/domain.ts',
'当前对象权限、部门、空间、密级和治理版本共同决定访问。',
'关系型授权中的成员、继承和对象访问判定，可在复杂关系增长时替代部分查询。',
'企业隔离、策略版本、治理租约、来源/派生内容撤权、行范围、下载与发布分别授权。',
'先影子比对判定结果，再以限定对象类型接入；所有读写、检索、工具仍经过服务端业务门禁。',
'大：权限模型及双系统一致性',
'必须覆盖拒绝矩阵、即时撤权、缓存过期、部门变更及外部服务不可用时拒绝访问。')
add('OSS13','Temporal','temporalio/temporal','MIT（Server；SDK 分别核验）','P3','条件性局部替换','F03,F06,F07,O04',
'apps/api/src/main/java/com/dreamcore/workspace/collection/CollectionWorker.java|apps/api/src/main/java/com/dreamcore/workspace/conversation/ConversationWorker.java',
'已有数据库任务、Worker 领取、尝试、暂停和重试。',
'后续大量跨服务长任务的持久编排、定时器、断点恢复及重试基础设施。',
'用户可见状态、幂等业务操作、取消语义、PPT 确认、未知结果核对及发布权限。',
'仅新建的长流程先接 Activity/Workflow；不能让两套队列同时拥有同一任务执行权。',
'大：额外服务、重放约束与任务迁移',
'进程中断恢复无重复成果、取消后不写回、未知结果不盲重试；当前规模未证明需要重构。')
add('OSS14','Debezium','debezium/debezium','Apache-2.0','P3','增量采集补强','F04,O03',
'apps/api/src/main/java/com/dreamcore/workspace/collection/CollectionSchedule.java|apps/api/src/main/java/com/dreamcore/workspace/collection/CollectionAdapter.java',
'现有来源按定时或手动采集快照，适合小时级更新。',
'当业务明确需要低延迟变更时，用 CDC 连接器采集数据库日志变更。',
'数据许可范围、快照版本、字段口径、事件去重、删除语义及前后授权。',
'在来源支持且授权日志读取后，变更先进入隔离缓冲，再合成平台认可的快照；不是任意数据库即插即用。',
'大：数据库日志权限、消息通道和恢复运维',
'验证首次快照到增量切换、乱序、重放、删除、断连续传和 schema 改变；小时级足够时不引入。')
add('OSS15','LiteLLM','BerriAI/litellm','核心 MIT；enterprise 另行许可','P2','模型接入补强','F03,F06,O04',
'engine/src/runtime/model-routing.ts|engine/src/runtime/metered-model.ts',
'已有模型适配器、路由与用量记录。',
'供应商持续增加时，统一模型 API、路由、连接故障处理和内部网关观测。',
'任务预算、业务用量账本、未知计量、工具授权、真实回执以及模型能力约束。',
'作为现有模型适配器下游网关，先接一个模型；控制重试归属，避免平台与网关叠加重试重复调用。',
'中：额外代理、密钥范围与重试对齐',
'流式取消、工具调用、错误映射、能力差异和真实计量一致后才扩展；供应商少时收益有限。',
'enterprise 目录单独许可；免费核心与商业治理功能分开选。')
add('OSS16','LangGraph','langchain-ai/langgraph','开源核心 MIT','P3','引擎备选，暂不替换','F06,O04',
'engine/src/runtime/harness.ts|engine/package.json',
'已有 DeepSeek Harness 核心包、受控工具、尝试协议和模型计量。',
'仅在明确需要图式 Agent 编排时，可替代引擎内部的一部分控制循环与检查点。',
'平台任务协议、工具回调授权、成本、成果验证、用户确认、来源版本和取消语义。',
'同一任务协议下用独立执行适配器比较，不能把 LangGraph 的示例记忆直接接入企业共享知识。',
'大：执行状态与协议一致性',
'任务恢复/暂停/确认/失败回执等效，质量和成本有实测收益再迁移；LangSmith 等平台能力不等于开源核心附送。')
add('OSS17','RAGFlow','infiniflow/ragflow','Apache-2.0','P2','检索服务备选','F04,F06,O02',
'apps/api/src/main/java/com/dreamcore/workspace/knowledge/KnowledgeService.java|apps/api/src/main/java/com/dreamcore/workspace/scene/SceneService.java',
'当前有本地资料检索、独立场景 Wiki 和平台 Wiki 两条发布路径。',
'复杂文档分块、检索或知识草稿编译，可作为 WeKnora 的对照候选。',
'现有 Wiki 的业务发布/下架、企业权限、版本及来源撤回；不直接迁入它的整套 Agent 与 UI。',
'用同一获准语料和问题与 WeKnora 对照，只选一套主检索服务；按锁定版本验证 API 和所需组件。',
'中至大：独立服务和索引生命周期',
'复杂表格召回、引用定位、越权隔离、资源占用与运维恢复对照达标再选；功能多不代表更适配。')
add('OSS18','Refine','refinedev/refine','MIT','P3','局部前端复用','F02,F03,O06',
'src/admin/PlatformConsole.tsx|src/admin/TenantConsole.tsx',
'三端已有 React 页面、业务接口、主题和业务交互。',
'未来新增管理 CRUD 页的表格、表单、筛选和数据请求组织，逐页复用。',
'现有三端导航、场景外壳、交接与审批流程、接口权限、产品视觉和状态文案。',
'为一个新增低风险管理页实现 dataProvider 后评估；不为套框架重写所有已有页面。',
'小至中（新页面）；大（全量改造）',
'校验错误、分页、冲突、无权和空态保持一致；前端 accessControlProvider 不能代替服务端授权。')
for item in items:
    if item['id'] in {'OSS01','OSS02','OSS03','OSS04','OSS05','OSS06','OSS07','OSS08','OSS09','OSS10','OSS11','OSS12','OSS13'} and 'O01' not in item['flows']:
        item['flows'].append('O01')
    for f in item['code']: assert (ROOT/f).is_file(), f
restricted=[
{'name':'Dify','repo':'langgenius/dify','license':'修改版 Apache-2.0，附加条件','url':'https://raw.githubusercontent.com/langgenius/dify/main/LICENSE','why':'其许可对多租户使用要求书面授权；使用其前端还有限制品牌/版权修改的条款。我们是多企业产品，不能按无附加条件 Apache-2.0 直接规划整体嵌入。可在核清商业授权后再评估，不据此断言所有后端使用都被禁止。'},
{'name':'n8n','repo':'n8n-io/n8n','license':'Sustainable Use License；ee 商业许可','url':'https://raw.githubusercontent.com/n8n-io/n8n/master/LICENSE.md','why':'当前许可限制为内部业务或非商业/个人用途等范围；作为向客户提供的产品能力与内部自动化用途须区分。不列入可自由嵌入商用多企业产品的首选清单。'},
{'name':'Airbyte 主仓库','repo':'airbytehq/airbyte','license':'Elastic License 2.0','url':'https://raw.githubusercontent.com/airbytehq/airbyte/master/LICENSE','why':'当前主仓库对向第三方提供可访问实质功能的托管/管理服务有限制。单独连接器、CDK、不同版本可能许可不同，不能把整个平台视为无条件开放的采集积木；本轮先评估 dlt。'}]
report={'date':'2026-10-17','status':'已选 WeKnora；首批代码适配默认关闭，未部署服务、未完成运行验收','items':items,'restricted':restricted,
'priorities':{'P1':'优先做对照验证，不等于立即上线','P2':'有明确需求或瓶颈时引入','P3':'条件成立再评估，当前不建议迁移','已有':'已在代码中使用，继续维护'}}
(HERE/'opensource-options.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
lines=['# 开源组件替代研判 · 2026-10-17','',
'结论：可复用的重点是执行内核和通用组件。2026-10-18 已选择 WeKnora 检索，并接入可选 Docling PDF 与 Langfuse 元数据观测；保留三端业务入口、权限与治理规则。没有证据支持为“全开源化”重写三端。','',
'首轮研判保留历史，2026-10-18 用户已选择 WeKnora。三项首批适配默认关闭，Docling 已作合成 PDF 验证；WeKnora/Langfuse 服务未部署，详见 [接入与验证](../交接/第一批开源接入-WeKnora-2026-10-18.md)。其余项目仍是候选，不因列入研判而视为已确认。','',
'## 阅读方法','',
'原 F01—F08 中的虚线和彩色候选框是方案标注，不表示已接入。O01—O06 展示拟议接入流程；I01—I20 继续记录当前实现。绿色为优先验证，黄色为条件候选，紫色为已经使用，蓝色为保留的业务。WeKnora、pgvector、RAGFlow 是可比较的路线，不需要全装。','',
'## 对照总表','',
'| 功能部位 | 候选 | 判断 | 顺序 | 替换边界 | 集成代价 |','| --- | --- | --- | --- | --- | --- |']
for i in items: lines.append(f"| {i['flows'][0]} | [{i['name']}]({i['url']}) | {i['kind']} | {i['priority']} | {i['replace']} | {i['effort']} |")
lines+=['','## 优先顺序与退出条件','','1. **资料解析**：先把复杂 PDF 作为 Docling 的唯一替换切片；若中文表格与定位没有改善，继续用现有解析器。','2. **知识检索**：已选 WeKnora 负责索引、混合召回和重排。pgvector 与 RAGFlow 本轮不另行接入；后续用获准语料验证语义质量和容量。','3. **运行诊断**：先把 Langfuse 接成内部观测旁路，证明能找到当前难定位的故障后再扩展。','4. **组件与数据工具**：ECharts、Tiptap、dlt、GX、DuckDB 按已确认功能或性能瓶颈逐项引入；每项先证明减少重复开发，不能把工具能力反推成新增产品需求。','5. **身份、权限与编排**：Keycloak、OpenFGA、Temporal、LangGraph 仅在明确增长条件下评估；现有链路已实现，迁移成本和语义风险大于接一个库。','','未做工时实测，不给“节省百分之多少”或精确迁移天数。所有候选都需计入适配、回归、升级与运维成本。','','## 逐项研判','']
for i in items:
    lines += [f"### {i['id']} {i['name']} · {i['priority']} · {i['kind']}",'',f"**当前实现：** {i['current']}",f"\n**可以交给它：** {i['replace']}",f"\n**仍由本项目负责：** {i['retain']}",f"\n**接法：** {i['approach']}",f"\n**代价与通过条件：** {i['effort']}。{i['gate']}",f"\n**许可范围：** {i['license']}。{i['licenseNote']}",f"\n**流程位置：** {'、'.join(i['flows'])}。",'\n源码依据：'+'、'.join(f'[{Path(c).name}]({Path(os.path.relpath(ROOT/c, HERE)).as_posix()})' for c in i['code'])+'。',f"\n官方依据：[{i['name']} 官方仓库]({i['url']})；本次仓库快照 [{i['sha'][:8]}]({i['url']}/tree/{i['sha']})（提交时间 {i['commitDate']}）。这是调查快照，不是批准部署的版本。",'']
lines+=['## 不作为无条件开源替代的项目','', '以下是实际选型需要区分的许可边界，按拟嵌入组件、版本与交付方式确认；不把这些项目笼统归为“不能商业使用”。','']
for r in restricted: lines += [f"- **[{r['name']}]({r['url']})**：{r['license']}。{r['why']}"]
lines+=['','## 应保留的核心','','- 企业开通与负责人激活、成员/空间/职责交接、总部支持访问和企业暂停。','- 来源授权、版本固定、治理租约、权限变更、检索与工具二次校验、派生内容失效。','- 画报选题、五类内容、证据校验、关注板、反馈与经验准入规则。','- 私人文稿与共享成果分离，PPT 大纲确认，发布动作与可追溯任务回执。','','这些能力也能用通用库实现其中的计算、存储或界面部件，但没有发现可不加业务适配直接接管全部语义的开源项目。','','## 调研依据与限制','','只使用官方仓库、许可和文档；当日仓库元信息及提交 SHA 保存在 opensource-sources.json。没有以星数推断安全或稳定性，没有对候选项目做漏洞审计、压测、模型质量或部署验收。主仓库许可不代表可选模型、依赖、企业模块及镜像打包许可相同。','','既有开源复用还包括 React、Spring Boot、Fastify、数据库驱动、Mammoth、PDF 工具等；本次聚焦用户可感知功能的替代点，不把已有基础框架重新算成待替代工作。']
(HERE/'04-开源替代研判.md').write_text('\n'.join(lines)+'\n')
e=html.escape
cards=[]
for i in items:
    fields=[('当前实现',i['current']),('可替代部分',i['replace']),('本项目保留',i['retain']),('接入方式',i['approach']),('代价',i['effort']),('通过条件',i['gate']),('许可',i['license']+'。'+i['licenseNote'])]
    cards.append(f'<section id="{i["id"]}" class="item" data-search="{e(json.dumps(i,ensure_ascii=False))}"><div class="tag">{i["id"]} · {i["priority"]} · {e(i["kind"])}</div><h2>{e(i["name"])}</h2>'+''.join(f'<p><b>{k}：</b>{e(v)}</p>' for k,v in fields)+f'<p><b>对应流程：</b>'+ ' · '.join(f'<a href="index.html#{f}">{f}</a>' for f in i['flows'])+'</p><details><summary>源码与官方依据</summary>'+''.join(f'<p><code>{e(c)}</code></p>' for c in i['code'])+f'<p><a href="{i["url"]}" target="_blank" rel="noopener">官方仓库</a> · <a href="{i["url"]}/tree/{i["sha"]}" target="_blank" rel="noopener">快照 {i["sha"][:8]}</a> · 提交 {i["commitDate"]}</p></details></section>')
rows=''.join(f'<tr><td><a href="#{i["id"]}">{e(i["name"])}</a></td><td>{i["priority"]}</td><td>{e(i["kind"])}</td><td>{e(i["replace"])}</td></tr>' for i in items)
page='''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Mengine · 开源替代研判</title><style>body{margin:0;color:#173249;background:#f5f8fa;font:15px/1.8 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}header{background:#122e43;color:white;padding:24px max(24px,calc((100vw - 1120px)/2))}header a{color:#bde0f6}main{max-width:1120px;margin:auto;padding:24px}h1{font-size:28px;margin:0}h2{font-size:22px;margin:5px 0 12px}h3{margin:14px 0 6px}.intro,.item,.limits{padding:24px;border:1px solid #dae5ed;background:white;border-radius:10px;margin-bottom:20px}.tag{color:#226345;font-size:13px}a{color:#1e5e91}p{margin:10px 0}code{overflow-wrap:anywhere;font-size:12px}summary{cursor:pointer;color:#37637e}table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:10px;text-align:left;border-bottom:1px solid #dce5ec;vertical-align:top}th{background:#e9f1f7}input{font:inherit;width:100%;box-sizing:border-box;border:1px solid #aac1d3;border-radius:6px;padding:12px;margin:16px 0}.table{overflow:auto}small{color:#526c7d}[hidden]{display:none!important}@media(max-width:600px){main{padding:14px}.intro,.item,.limits{padding:17px}h1{font-size:24px}}@media print{input{display:none}.item{break-inside:avoid}}</style><header><h1>哪些部分可以交给开源项目？</h1><p>2026-10-17 · 18 项局部复用研判 · WeKnora 已选 · 首批默认关闭、未部署服务</p><a href="index.html#O01">返回开源替代流程图</a> · <a href="04-开源替代研判.md">完整 Markdown</a></header><main><section class="intro"><h2>先替换能力内核，保留业务规则</h2><p>优先验证 <b>Docling 的复杂文档解析</b>，已选 <b>WeKnora 检索路线</b>，再用 <b>Langfuse 补内部诊断</b>。PPT 已使用 PptxGenJS，继续复用。</p><p>三端业务、权限、来源版本、画报规则和成果发布继续由现有系统掌握。开源项目可以只承担一个函数、组件或执行步骤。</p><small>P1 优先验证 · P2 有需求/瓶颈再引入 · P3 条件成立再评估 · 已有继续维护。判断与集成方案为技术研判；未承诺节省工时或运行效果。</small></section><div class="table"><table><thead><tr><th>项目</th><th>顺序</th><th>结论</th><th>实际可替代部分</th></tr></thead><tbody>'''+rows+'''</tbody></table></div><input id="filter" placeholder="搜索项目、功能、流程号或许可" aria-label="搜索研判条目">'''+''.join(cards)+'<section class="limits"><h2>受限许可：不能按无条件开源嵌入规划</h2>'+''.join(f'<h3><a href="{r["url"]}" target="_blank" rel="noopener">{r["name"]}</a></h3><p>{e(r["license"])}。{e(r["why"])}</p>' for r in restricted)+'''</section><section class="limits"><h2>核查范围</h2><p>公开官方仓库、许可、提交快照，以及本机当前代码边界。首批代码适配与合成验证见接入记录；WeKnora/Langfuse 服务未部署，未开展压测、漏洞审计或真实语义模型验收。主仓库许可与模型、依赖、企业模块分别核对。原 I01—I20 仍描述当前实现，新增 O 图和 F 图虚线标注描述候选方案。</p></section></main><script>document.getElementById('filter').oninput=e=>{const q=e.target.value.toLowerCase();document.querySelectorAll('.item').forEach(x=>x.hidden=!x.dataset.search.toLowerCase().includes(q))}</script></html>'''
(HERE/'开源替代研判.html').write_text(page)
print(f'Created {len(items)} assessments and {len(restricted)} license-boundary notes.')
