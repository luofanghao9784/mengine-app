import {
  ArrowRight,
  AudioLines,
  BarChart3,
  Check,
  FileText,
  Folder,
  FolderOpen,
  Image,
  Presentation,
} from 'lucide-react';
export type SkillId = 'ppt' | 'dashboard' | 'organizer' | 'infographic' | 'meeting';
export type Skill = {
  id: SkillId;
  title: string;
  eyebrow: string;
  description: string;
  output: string;
  input: string;
  steps: string[];
  source: string;
  url: string;
  boundary: string;
  sample: string;
  color: string;
};
export const skills: Skill[] = [
  {
    id: 'ppt',
    title: 'PPT 生成',
    eyebrow: '把想法讲清楚',
    description: '从一份资料到一场有条理的汇报，先确认内容，再生成可编辑演示文稿。',
    output: '可编辑 PPTX · 内容源文件',
    input: '一个主题，或你选定的空间资料',
    steps: ['选择资料与汇报目标', '核对大纲、正文与数据', '确认生成，下载演示文稿'],
    source: 'MiniMax-AI / skills',
    url: 'https://github.com/MiniMax-AI/skills/tree/60aaae52bb2af8162732751a4332f62a5fef518b/skills/pptx-generator',
    boundary:
      '当前固定版式支持 1–8 页。真实生成链路已完成本地验收，内容口径仍需核对；模板导入、正文编辑和在线预览为待开发功能。',
    sample: '季度经营复盘',
    color: 'violet',
  },
  {
    id: 'dashboard',
    title: 'Web 数据看板',
    eyebrow: '让数据自己说话',
    description: '把一张表变成可筛选、可查看明细的数据看板，指标和来源有据可查。',
    output: '交互网页 · 数据快照',
    input: '空间中的 Excel / CSV 文件',
    steps: ['选择数据，预览工作表和字段', '确认指标口径与分析维度', '生成看板，筛选和查看明细'],
    source: 'Anthropic / web-artifacts-builder',
    url: 'https://github.com/anthropics/skills/tree/main/skills/web-artifacts-builder',
    boundary: '首版基于固定数据快照，不自动同步数据库。生成页面需隔离运行；目前仍在接入中。',
    sample: '业务经营看板',
    color: 'blue',
  },
  {
    id: 'organizer',
    title: '个人空间智能整理',
    eyebrow: '资料各归其位',
    description: '找出重复与散落的资料，先看分类和重命名预案，再决定如何整理。',
    output: '整理预案 · 变更记录',
    input: '你在梦擎个人空间中选定的文件夹',
    steps: ['选择个人空间的整理范围', '逐项核对移动、命名和重复建议', '确认执行，查看记录与撤销'],
    source: 'ComposioHQ / file-organizer（候选）',
    url: 'https://github.com/ComposioHQ/awesome-claude-skills/tree/master/file-organizer',
    boundary:
      '只整理梦擎个人空间，不访问电脑本地文件。默认不删除、不覆盖；上游许可和平台撤销能力仍待完成核验。',
    sample: '项目资料分类预案',
    color: 'green',
  },
  {
    id: 'infographic',
    title: '一图读懂',
    eyebrow: '复杂内容，一眼看懂',
    description: '提炼长文的重点，用结构清晰的信息图，讲清关系、流程与结论。',
    output: '信息图 · 文字摘要',
    input: '文字内容或空间中的文档',
    steps: ['选择资料，确认重点', '选择布局、风格和尺寸', '检查文字与数字，保存图片'],
    source: 'JimLiu / baoyu-infographic',
    url: 'https://github.com/JimLiu/baoyu-skills/tree/main/skills/baoyu-infographic',
    boundary: '输出为图片，不能当成可编辑的数据图表。图像服务与中文文字准确性待验收。',
    sample: '项目推进一图概览',
    color: 'orange',
  },
  {
    id: 'meeting',
    title: '会议录音整理',
    eyebrow: '留下结论，找回上下文',
    description: '将已有会议录音整理成逐字稿、议题、结论和待办，方便回听核对。',
    output: '逐字稿 · 纪要 · 待办清单',
    input: '空间中已上传的会议音视频',
    steps: ['选择录音，补充人名和术语', '查看转写，回听并校对', '确认纪要与待办，保存成果'],
    source: 'AWS samples / meeting-minutes-skill',
    url: 'https://github.com/aws-samples/sample-for-kiro-meeting-minutes-skill',
    boundary: '不会自动入会或录音，不自动派发任务。云端转写和说话人识别尚未接入。',
    sample: '产品周会纪要',
    color: 'rose',
  },
];
export function Preview({ id, large = false }: { id: SkillId; large?: boolean }) {
  return (
    <div
      className={`skill-art ${id} ${large ? 'large' : ''}`}
      aria-label={`${skills.find((s) => s.id === id)?.sample}，合成示例`}
    >
      {id === 'ppt' && (
        <div className="sk-deck">
          <i className="sk-sheet" />
          <i className="sk-sheet" />
          <div className="sk-sheet sk-slide">
            <span className="sk-kicker">季度经营复盘</span>
            <b>
              把每一份努力
              <br />
              讲成清晰的成果
            </b>
            <div className="sk-lines">
              <i />
              <i />
            </div>
            <div className="sk-bars">
              <i />
              <i />
              <i />
              <i />
            </div>
            <em>01 / 06</em>
          </div>
        </div>
      )}
      {id === 'dashboard' && (
        <div className="sk-sheet sk-board">
          <div className="sk-head">
            <b>经营概览</b>
            <span>本季度</span>
          </div>
          <div className="sk-kpis">
            <div>
              <small>季度营收</small>
              <b>
                450<em>万</em>
              </b>
            </div>
            <div>
              <small>新签客户</small>
              <b>52</b>
            </div>
            <div>
              <small>回款率</small>
              <b>
                86<em>%</em>
              </b>
            </div>
          </div>
          <div className="sk-chart">
            {[38, 52, 46, 64, 58, 78, 92].map((h, i) => (
              <i key={i} style={{ height: `${h}%` }} />
            ))}
          </div>
        </div>
      )}
      {id === 'organizer' && (
        <div className="sk-tidy">
          <div className="sk-loose">
            <span className="sk-sheet">
              <FileText size={12} /> 方案_最终版
            </span>
            <span className="sk-sheet">
              <FileText size={12} /> 会议记录_01
            </span>
            <span className="sk-sheet">
              <FileText size={12} /> 数据_新
            </span>
          </div>
          <ArrowRight size={18} />
          <div className="sk-sheet sk-folders">
            <span>
              <Folder size={14} /> 项目方案 <small>3</small>
            </span>
            <span>
              <Folder size={14} /> 会议资料 <small>5</small>
            </span>
            <span>
              <Folder size={14} /> 经营数据 <small>2</small>
            </span>
          </div>
        </div>
      )}
      {id === 'infographic' && (
        <div className="sk-sheet sk-poster">
          <b>从想法，到行动</b>
          <div className="sk-flow">
            {['明确目标', '拆解路径', '推进落地'].map((label, i) => (
              <span key={label}>
                <i>{i + 1}</i>
                <small>{label}</small>
              </span>
            ))}
          </div>
          <div className="sk-lines">
            <i />
            <i />
          </div>
        </div>
      )}
      {id === 'meeting' && (
        <div className="sk-sheet sk-minutes">
          <div className="sk-wave">
            <AudioLines size={14} />
            <div>
              {Array.from({ length: 34 }, (_, i) => (
                <i key={i} style={{ height: 4 + ((i * 17) % 19) }} />
              ))}
            </div>
            <small>32:18</small>
          </div>
          <b>产品周会 · 纪要</b>
          <span>
            <Check size={12} /> 关键结论已归纳
          </span>
          <span>
            <Check size={12} /> 待办与原始录音关联
          </span>
        </div>
      )}
    </div>
  );
}
export const iconMap = {
  ppt: Presentation,
  dashboard: BarChart3,
  organizer: FolderOpen,
  infographic: Image,
  meeting: AudioLines,
};
