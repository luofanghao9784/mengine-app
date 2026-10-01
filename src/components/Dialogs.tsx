import { useState, type FormEvent } from 'react';
import {
  ArrowUpRight,
  Check,
  FileText,
  Folder,
  Plus,
  Search,
  Trash2,
  Upload,
  Archive,
  RotateCcw,
  Sparkles,
  Download,
} from 'lucide-react';
import { useDemo, useUI, type DialogSpec } from '../store';
import {
  activity,
  addChat,
  addMessage,
  canEdit,
  createMaterial,
  editMaterial,
  latest,
  publishSnapshot,
  requestShare,
  renameDemoProfile,
  spaceName,
  today,
  uid,
  type Followup,
  type Space,
} from '../model';
import { workspaceKind, workspaceKindName } from '../workspaceExamples';
import { Badge, Button, Field, Modal } from './ui';
import { MaterialDetails } from './MaterialView';
import { MaterialSharing } from './MaterialSharing';
import { FolderDialog, FolderSelect, MoveMaterialDialog } from './LibraryDialogs';
import { canReadMaterial, libraryPath, locationNames, visibleSpaces } from '../libraryModel';
import { DreamCard } from '../pages/Conversation';
import { AnchoredPopover } from './AnchoredPopover';
import { DreamcoreLogo } from './DreamcoreLogo';

export function Dialogs({ spec }: { spec: DialogSpec }) {
  const { state, change, reset } = useDemo();
  const ui = useUI();
  const close = ui.close;
  const titles: Record<string, string> = {
    search: '搜索会话和资料',
    settings: '个人设置',
    help: '欢迎体验工作空间',
    move: '选择工作空间',
    'start-space': '选择会话归属',
    'chat-options': '会话选项',
    space: spec.id ? '空间设置' : '新建工作空间',
    members: '空间成员',
    attach: '添加资料到会话',
    share: '发布到企业资料库',
    folder: '新建文件夹',
    'move-material': '移动到文件夹',
    edit: '编辑资料',
    upload: '添加资料',
    versions: '版本记录',
    details: '资料详情',
    record: spec.id ? '编辑跟进记录' : '新增跟进',
    dream: '梦境整理建议',
    rename: '重命名会话',
    confirm: spec.title || '确认操作',
  };
  const wide = ['details', 'versions'].includes(spec.kind);
  let content;
  switch (spec.kind) {
    case 'confirm':
      content = (
        <>
          <p className="confirm-copy">{spec.text}</p>
          <div className="modal-actions">
            <Button onClick={close}>取消</Button>
            <Button
              variant="primary"
              onClick={() => {
                close();
                spec.onConfirm?.();
              }}
            >
              确认并继续
            </Button>
          </div>
        </>
      );
      break;
    case 'details':
    case 'versions':
      content = state.materials.some((d) => d.id === spec.id && canReadMaterial(state, d)) ? (
        <MaterialDetails
          id={spec.id!}
          initialVersionId={spec.initial}
          initialTab={spec.kind === 'versions' ? 'versions' : 'content'}
        />
      ) : (
        <p>资料暂不可用。</p>
      );
      break;
    case 'dream':
      content = <DreamCard />;
      break;
    case 'search':
      content = <SearchDialog />;
      break;
    case 'move':
    case 'start-space':
      content = <MoveDialog spec={spec} />;
      break;
    case 'share':
      content = <MaterialSharing id={spec.id!} onDone={close} onCancel={close} />;
      break;
    case 'edit':
      content = <EditDialog id={spec.id!} />;
      break;
    case 'upload':
      content = <UploadDialog target={spec.target || 'personal'} folderId={spec.folderId} />;
      break;
    case 'folder':
      content = <FolderDialog spec={spec} />;
      break;
    case 'move-material':
      content = <MoveMaterialDialog id={spec.id!} />;
      break;
    case 'record':
      content = <RecordDialog spec={spec} />;
      break;
    case 'attach':
      content = <AttachDialog spec={spec} />;
      break;
    case 'space':
      content = <SpaceDialog id={spec.id} />;
      break;
    case 'settings':
      content = <SettingsDialog />;
      break;
    case 'rename':
      content = <RenameDialog id={spec.id!} />;
      break;
    case 'members': {
      const space = state.spaces.find((s) => s.id === spec.id)!;
      content = (
        <>
          <p className="subtle">{space.name} · 演示成员与访问范围</p>
          <div className="member-list">
            {space.members.map((name) => (
              <div className="recent-row" key={name}>
                <span className="avatar small">{name[0]}</span>
                <span className="grow">{name}</span>
                <Badge>
                  {name === space.owner
                    ? '空间负责人'
                    : name === state.profile.name && !space.canEdit
                      ? '查看与引用'
                      : '空间成员'}
                </Badge>
              </div>
            ))}
          </div>
          <p className="inline-notice">
            资料入库权限由空间负责人处理。需要授权时，可从资料的共享操作发起申请。
          </p>
        </>
      );
      break;
    }
    case 'chat-options': {
      const c = state.chats.find((c) => c.id === spec.id)!;
      content = (
        <div className="option-list">
          <Button icon={FileText} onClick={() => ui.open({ kind: 'rename', id: c.id, anchor: spec.anchor })}>
            重命名会话
          </Button>
          <Button icon={Folder} onClick={() => ui.open({ kind: 'move', id: c.id, anchor: spec.anchor })}>
            移动到工作空间
          </Button>
          <Button
            icon={Archive}
            onClick={() =>
              ui.open({
                kind: 'confirm',
                anchor: spec.anchor,
                title: '归档这段会话',
                text: '会话会从侧栏收起，资料和成果保留。可在个人设置中恢复。',
                onConfirm: () => {
                  change((s) => {
                    s.chats.find((x) => x.id === c.id)!.archived = true;
                  });
                  ui.go('home');
                  ui.toast('会话已归档');
                },
              })
            }
          >
            归档会话
          </Button>
        </div>
      );
      break;
    }
    case 'help':
      content = (
        <>
          <div className="help-brand">
            <DreamcoreLogo wordmark />
          </div>
          <h3>一起确认工作方式，而不只是看页面</h3>
          <p className="subtle">
            这是纯前端交互 Demo。空谷资讯来自公开报道，内部经营、客户、研发和活动记录为模拟数据。 AI
            使用预编写的分析场景，尚未连接真实模型、收银或企业服务。
          </p>
          <div className="help-steps">
            {(state.scenario === 'konggu'
              ? [
                  [
                    '01',
                    '从经营问题开始',
                    '汇集销售、活动与收款，查看经营复盘及引用资料。',
                    'chat/kg-review',
                  ],
                  [
                    '02',
                    '连接资讯与研发',
                    '把贵州风味报道、顾客反馈与配方成本放在一起。',
                    'chat/kg-development',
                  ],
                  [
                    '03',
                    '让方案成为团队资料',
                    '查看30人读书会筹备方案，编辑后共享到活动空间。',
                    'chat/kg-event-plan',
                  ],
                ]
              : [
                  ['01', '从会话开始', '打开客户 A 方案，修改内容、查看版本，再共享给团队。', 'chat/client'],
                  ['02', '处理一个主题', '让梦境按客户重新归类，或模拟负责人处理共享申请。', 'briefing'],
                  [
                    '03',
                    '让数据流动起来',
                    '在客户跟进应用添加记录，再看智能画报同步更新。',
                    'apps/sales/followup',
                  ],
                ]
            ).map(([n, title, text, path]) => (
              <button
                key={n}
                onClick={() => {
                  if (path === 'chat/client') ui.preview('proposal');
                  ui.go(path);
                }}
              >
                <span>{n}</span>
                <div>
                  <strong>{title}</strong>
                  <p>{text}</p>
                </div>
                <ArrowUpRight size={17} />
              </button>
            ))}
          </div>
          <p className="inline-notice">
            修改只保存在当前浏览器。可在个人设置中重置；资料上传支持文本文件，权限流程均为模拟。
          </p>
          <div className="modal-actions">
            <Button variant="primary" onClick={close}>
              开始体验
            </Button>
          </div>
        </>
      );
      break;
    default:
      content = <Button onClick={close}>关闭</Button>;
  }
  if (spec.anchor)
    return (
      <AnchoredPopover
        anchor={spec.anchor}
        side={spec.anchorSide}
        title={titles[spec.kind] || '会话操作'}
        onClose={close}
      >
        {content}
      </AnchoredPopover>
    );
  return (
    <Modal title={titles[spec.kind] || '工作空间'} onClose={close} wide={wide}>
      {content}
    </Modal>
  );
}
function MoveDialog({ spec }: { spec: DialogSpec }) {
  const { state, change } = useDemo();
  const ui = useUI();
  const chat = state.chats.find((c) => c.id === spec.id);
  const [selected, setSelected] = useState(chat?.space || spec.target || 'none');
  return (
    <>
      <p className="subtle">空间决定后续工作方向与资料调用优先级。已有引用和保存成果会保留原位置。</p>
      <div className="choice-list">
        {[{ id: 'none', name: '未归入空间', description: '先自由讨论，稍后再归类' }, ...state.spaces].map(
          (s) => (
            <button
              key={s.id}
              className={selected === s.id ? 'selected' : ''}
              onClick={() => setSelected(s.id)}
            >
              <Folder size={19} />
              <span className="grow">
                <strong>{s.name}</strong>
                <small>{s.description}</small>
              </span>
              {selected === s.id && <Check size={17} />}
            </button>
          ),
        )}
      </div>
      <div className="modal-actions">
        <Button onClick={ui.close}>取消</Button>
        <Button
          variant="primary"
          onClick={() => {
            if (chat) {
              change((s) => {
                const c = s.chats.find((c) => c.id === chat.id)!;
                c.space = selected;
                addMessage(
                  c,
                  'assistant',
                  `会话已归入${spaceName(s, selected)}。接下来的工作将参考新空间说明；此前引用和成果位置保持原样。`,
                );
              });
              ui.close();
              ui.toast('会话归属已更新');
            } else ui.go(`home/${selected}`);
          }}
        >
          {chat ? '确认移动' : '在此开始'}
        </Button>
      </div>
    </>
  );
}
function SearchDialog() {
  const { state } = useDemo();
  const ui = useUI();
  const [query, setQuery] = useState('');
  const chats = state.chats.filter((c) => !c.archived && c.title.includes(query));
  const docs = state.materials.filter((d) => `${d.title} ${d.summary}`.includes(query));
  return (
    <>
      <div className="search-input full">
        <Search size={17} />
        <input
          autoFocus
          aria-label="全局搜索"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索会话标题、资料标题或简介"
        />
      </div>
      <div className="search-results">
        <h3>会话</h3>
        {chats.slice(0, 6).map((c) => (
          <button
            className="recent-row"
            key={c.id}
            onClick={() => {
              ui.preview(c.messages.findLast((m) => m.doc)?.doc || null);
              ui.go(`chat/${c.id}`);
            }}
          >
            <FileText size={17} />
            <span className="grow">
              {c.title}
              <small>{spaceName(state, c.space)}</small>
            </span>
            <ArrowUpRight size={15} />
          </button>
        ))}
        <h3>资料</h3>
        {docs.slice(0, 6).map((d) => (
          <button className="recent-row" key={d.id} onClick={() => ui.go(`library/${d.space}/${d.id}`)}>
            <FileText size={17} />
            <span className="grow">
              {d.title}
              <small>{spaceName(state, d.space)}</small>
            </span>
            <ArrowUpRight size={15} />
          </button>
        ))}
        {!chats.length && !docs.length && (
          <p className="empty-inline subtle">没有匹配结果，试试“方案”或“价格”。</p>
        )}
      </div>
    </>
  );
}
function RenameDialog({ id }: { id: string }) {
  const { state, change } = useDemo();
  const ui = useUI();
  const [name, setName] = useState(state.chats.find((c) => c.id === id)!.title);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        change((s) => {
          s.chats.find((c) => c.id === id)!.title = name.trim();
        });
        ui.close();
        ui.toast('会话名称已更新');
      }}
    >
      <Field label="会话名称">
        <input autoFocus value={name} required maxLength={48} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="modal-actions">
        <Button onClick={ui.close}>取消</Button>
        <Button type="submit" variant="primary" disabled={!name.trim()}>
          保存名称
        </Button>
      </div>
    </form>
  );
}
function EditDialog({ id }: { id: string }) {
  const { state, change } = useDemo();
  const ui = useUI();
  const doc = state.materials.find((d) => d.id === id)!;
  const [title, setTitle] = useState(doc.title);
  const [summary, setSummary] = useState(doc.summary);
  const [content, setContent] = useState(latest(doc).content);
  const [note, setNote] = useState('手动修改内容');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim() || !content.trim() || !summary.trim()) return;
        const result = change((s) =>
          editMaterial(s, id, content, title.trim(), summary.trim(), note.trim() || '手动修改'),
        );
        ui.preview(result.id);
        ui.close();
        ui.toast(result.id === id ? '新版本及简介已保存' : '个人修订稿已保存，共享原件保持不变');
        if (result.id !== id) ui.go(`library/personal/${result.id}`);
      }}
    >
      {!canEdit(state, doc.space) && (
        <p className="inline-notice">
          你没有这份共享资料的维护权限。保存后会生成个人修订稿，可再申请更新到原空间。
        </p>
      )}
      <Field label="资料标题">
        <input value={title} required maxLength={80} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="简介索引">
        <textarea
          value={summary}
          required
          maxLength={300}
          rows={2}
          onChange={(e) => setSummary(e.target.value)}
        />
      </Field>
      <Field label="正文">
        <textarea
          className="edit-content"
          value={content}
          required
          maxLength={80000}
          rows={9}
          onChange={(e) => setContent(e.target.value)}
        />
      </Field>
      <Field label="版本说明">
        <input value={note} maxLength={100} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div className="modal-actions">
        <Button onClick={ui.close}>取消</Button>
        <Button
          type="submit"
          variant="primary"
          disabled={!title.trim() || !content.trim() || !summary.trim()}
        >
          保存新版本
        </Button>
      </div>
    </form>
  );
}
function UploadDialog({ target, folderId }: { target: string; folderId?: string }) {
  const { state, change } = useDemo();
  const ui = useUI();
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [content, setContent] = useState('');
  const [error, setError] = useState('');
  const enterprise = target !== 'personal';
  const [effective, setEffective] = useState(['all', 'enterprise'].includes(target) ? '' : target);
  const [folder, setFolder] = useState(folderId || '');
  const [visibility, setVisibility] = useState('空间成员');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!effective || !title.trim() || !content.trim() || !summary.trim()) return;
        try {
          const result = change((s) => {
            const d = createMaterial(s, title.trim(), content, summary.trim());
            if (effective === 'personal') d.folderId = folder || undefined;
            else if (canEdit(s, effective))
              return publishSnapshot(s, d.id, d.title, latest(d), d.summary, effective, visibility, folder);
            else requestShare(s, d.id, effective, visibility, folder);
            return d;
          });
          ui.go(libraryPath(result.space, result.folderId, result.id));
          ui.toast(canEdit(state, effective) ? '资料已添加，简介索引已建立' : '个人稿已保存，并提交入库申请');
        } catch (e) {
          setError((e as Error).message);
        }
      }}
    >
      {enterprise && (
        <Field label="目标工作空间">
          <select
            required
            value={effective}
            onChange={(e) => {
              setEffective(e.target.value);
              setFolder('');
            }}
          >
            <option value="" disabled>
              请选择资料所属工作空间
            </option>
            {visibleSpaces(state).map((space) => (
              <option key={space.id} value={space.id}>
                {space.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      {effective && <FolderSelect space={effective} value={folder} onChange={setFolder} />}
      {enterprise && (
        <Field label="查看范围">
          <select value={visibility} onChange={(e) => setVisibility(e.target.value)}>
            <option>空间成员</option>
            <option>仅空间负责人</option>
          </select>
        </Field>
      )}
      <label className="upload-zone">
        <Upload size={23} />
        <strong>选择文本文件</strong>
        <span>支持 .txt、.md、.csv，最大 500 KB；仅在浏览器读取</span>
        <input
          type="file"
          aria-label="选择上传文件"
          accept=".txt,.md,.csv"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            if (file.size > 500 * 1024 || !/\.(txt|md|csv)$/i.test(file.name)) {
              setError('请选择不超过 500 KB 的 TXT、Markdown 或 CSV 文件。');
              return;
            }
            try {
              const text = await file.text();
              setContent(text);
              setTitle(file.name.replace(/\.[^.]+$/, ''));
              setSummary(text.replace(/[#\n]/g, ' ').slice(0, 120));
              setError('');
            } catch {
              setError('无法读取该文件，请重新选择。');
            }
          }}
        />
      </label>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      <Button
        variant="ghost"
        icon={Sparkles}
        onClick={() => {
          setTitle('客户调研纪要');
          setSummary('本次客户调研的主要发现与后续安排。');
          setContent(
            '客户调研纪要\n\n客户希望统一团队资料入口，并能更方便地跟进合作进度。\n\n后续安排\n准备一份合作方案，在下周沟通时确认范围。',
          );
        }}
      >
        填入一份演示资料
      </Button>
      <Field label="资料标题">
        <input value={title} required maxLength={80} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="简介索引">
        <textarea
          value={summary}
          required
          maxLength={300}
          rows={2}
          onChange={(e) => setSummary(e.target.value)}
        />
      </Field>
      <Field label="正文">
        <textarea
          value={content}
          required
          maxLength={80000}
          rows={5}
          onChange={(e) => setContent(e.target.value)}
        />
      </Field>
      <p className="subtle">
        目标：
        {effective
          ? locationNames(state, effective, folder || undefined).join(' / ')
          : '请选择工作空间'} ·{' '}
        {effective === 'personal'
          ? '仅自己可见'
          : canEdit(state, effective)
            ? '按所选查看范围发布，保存即确认入库'
            : '先保存个人草稿，再申请入库'}
      </p>
      <div className="modal-actions">
        <Button onClick={ui.close}>取消</Button>
        <Button
          variant="primary"
          type="submit"
          disabled={!effective || !title.trim() || !content.trim() || !summary.trim()}
        >
          确认保存资料
        </Button>
      </div>
    </form>
  );
}
function AttachDialog({ spec }: { spec: DialogSpec }) {
  const { state, change } = useDemo();
  const ui = useUI();
  const [selected, setSelected] = useState<string[]>(spec.initial ? [spec.initial] : []);
  const [query, setQuery] = useState('');
  return (
    <>
      <p className="subtle">可以跨空间引用资料。引用不会移动原件，也不会改变会话归属。</p>
      <div className="search-input full">
        <Search size={16} />
        <input
          aria-label="搜索可引用资料"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索可用资料"
        />
      </div>
      <div className="attachment-list">
        {state.materials
          .filter((d) => `${d.title} ${spaceName(state, d.space)}`.includes(query))
          .map((d) => (
            <label className="check-row" key={d.id}>
              <input
                type="checkbox"
                checked={selected.includes(d.id)}
                onChange={(e) =>
                  setSelected(e.target.checked ? [...selected, d.id] : selected.filter((id) => id !== d.id))
                }
              />
              <span>
                <strong>{d.title}</strong>
                <small>
                  {spaceName(state, d.space)} · {d.status}
                </small>
              </span>
            </label>
          ))}
      </div>
      <div className="modal-actions">
        <Button onClick={ui.close}>取消</Button>
        <Button
          variant="primary"
          disabled={!selected.length}
          onClick={() => {
            const id = change((s) => {
              let c = s.chats.find((c) => c.id === spec.id);
              if (!c) c = addChat(s, '围绕资料开始工作');
              addMessage(c, 'user', `添加了 ${selected.length} 份参考资料。`);
              addMessage(
                c,
                'assistant',
                '参考资料已加入本次会话，可以基于这些资料继续生成方案。原始资料的位置与权限保留。',
                undefined,
                selected,
              );
              return c.id;
            });
            ui.close();
            ui.go(`chat/${id}`);
            ui.toast('资料已引用到会话');
          }}
        >
          引用 {selected.length || ''} 份资料
        </Button>
      </div>
    </>
  );
}
function SpaceDialog({ id }: { id?: string }) {
  const { state, change } = useDemo();
  const ui = useUI();
  const space = state.spaces.find((s) => s.id === id);
  const [name, setName] = useState(space?.name || '');
  const [description, setDescription] = useState(space?.description || '');
  const [instructions, setInstructions] = useState(space?.instructions || '');
  const [kind, setKind] = useState<NonNullable<Space['kind']>>(space ? workspaceKind(space) : 'project');
  const [error, setError] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        if (state.spaces.some((s) => s.name === name.trim() && s.id !== id)) {
          setError('这个空间名称已存在，请换一个名称。');
          return;
        }
        const nextId = change((s) => {
          if (id) {
            const current = s.spaces.find((s) => s.id === id)!;
            Object.assign(current, {
              kind,
              name: name.trim(),
              description: description.trim(),
              instructions: instructions.trim(),
            });
            return id;
          }
          const nextId = uid();
          s.spaces.push({
            id: nextId,
            kind,
            name: name.trim(),
            description: description.trim() || '一起推进工作，积累团队成果。',
            instructions: instructions.trim(),
            owner: s.profile.name,
            members: [s.profile.name],
            canEdit: true,
          });
          return nextId;
        });
        ui.go(`space/${nextId}`);
        ui.toast(id ? '空间设置已更新' : '工作空间已创建');
      }}
    >
      <Field label="空间名称">
        <input
          autoFocus
          value={name}
          required
          maxLength={24}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如：品牌内容、客户项目"
        />
      </Field>
      <Field label="空间类型" hint="用于区分工作场景，不改变成员权限。">
        <select
          aria-label="空间类型"
          value={kind}
          onChange={(e) => setKind(e.target.value as NonNullable<Space['kind']>)}
        >
          {(['project', 'department', 'business'] as const).map((value) => (
            <option value={value} key={value}>
              {workspaceKindName[value]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="空间简介">
        <input
          value={description}
          maxLength={120}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="这个空间主要承接什么工作？"
        />
      </Field>
      <Field label="AI 工作说明" hint="影响该空间后续会话的工作方向和资料调用优先级。">
        <textarea
          value={instructions}
          maxLength={1000}
          rows={4}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="例如：方案先说明结论，引用最新确认版资料。"
        />
      </Field>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <Button onClick={ui.close}>取消</Button>
        <Button variant="primary" type="submit" disabled={!name.trim()}>
          {id ? '保存设置' : '创建空间'}
        </Button>
      </div>
    </form>
  );
}
function RecordDialog({ spec }: { spec: DialogSpec }) {
  const { state, change } = useDemo();
  const ui = useUI();
  const old = state.records.find((r) => r.id === spec.id);
  const app = state.apps.find((a) => a.id === (old?.app || spec.target));
  const [customer, setCustomer] = useState(old?.customer || '');
  const [note, setNote] = useState(old?.note || '');
  const [status, setStatus] = useState<Followup['status']>(old?.status || '待跟进');
  const [date, setDate] = useState(old?.nextDate || '');
  const [owner, setOwner] = useState(old?.owner || state.profile.name);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!customer.trim() || !note.trim()) return;
        change((s) => {
          const values = { customer: customer.trim(), note: note.trim(), status, nextDate: date, owner };
          const row = s.records.find((r) => r.id === spec.id);
          if (row) Object.assign(row, values);
          else s.records.push({ ...values, id: uid(), app: spec.target!, date: today() });
          activity(s, app?.space || 'personal', `${old ? '更新' : '新增'}了${customer.trim()}的跟进记录`);
        });
        ui.close();
        ui.toast('记录已保存，智能画报已同步更新');
      }}
    >
      <div className="form-grid">
        <Field label="客户名称">
          <input
            autoFocus
            required
            maxLength={40}
            value={customer}
            onChange={(e) => setCustomer(e.target.value)}
            placeholder="例如：客户 G"
          />
        </Field>
        <Field label="跟进状态">
          <select value={status} onChange={(e) => setStatus(e.target.value as Followup['status'])}>
            <option>待跟进</option>
            <option>已联系</option>
            <option>已约定</option>
          </select>
        </Field>
      </div>
      <Field label="跟进内容">
        <textarea
          value={note}
          required
          maxLength={400}
          rows={4}
          onChange={(e) => setNote(e.target.value)}
          placeholder="这次沟通了什么，下一步如何安排？"
        />
      </Field>
      <div className="form-grid">
        <Field label="负责人">
          <select value={owner} onChange={(e) => setOwner(e.target.value)}>
            {[...new Set([state.profile.name, '陈言', '许然', ...(old ? [old.owner] : [])])].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </Field>
        {app?.hasDate && (
          <Field label="下次跟进日期">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        )}
      </div>
      <div className="modal-actions">
        <Button onClick={ui.close}>取消</Button>
        <Button variant="primary" type="submit" disabled={!customer.trim() || !note.trim()}>
          保存跟进记录
        </Button>
      </div>
    </form>
  );
}
function SettingsDialog() {
  const { state, change, reset } = useDemo();
  const ui = useUI();
  const [name, setName] = useState(state.profile.name);
  const [memory, setMemory] = useState('');
  return (
    <div className="settings-content">
      <div className="settings-profile">
        <span className="avatar">{state.profile.name[0]}</span>
        <div>
          <strong>{state.profile.name}</strong>
          <p className="subtle">体验账号 · 本地演示</p>
        </div>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          change((s) => renameDemoProfile(s, name.trim()));
          ui.toast('个人称呼已更新');
        }}
      >
        <Field label="如何称呼你">
          <div className="row">
            <input value={name} required maxLength={12} onChange={(e) => setName(e.target.value)} />
            <Button type="submit" disabled={!name.trim()}>
              保存
            </Button>
          </div>
        </Field>
      </form>
      <label className="check-row">
        <input
          type="checkbox"
          checked={state.profile.compact}
          onChange={(e) =>
            change((s) => {
              s.profile.compact = e.target.checked;
            })
          }
        />
        <span>
          <strong>紧凑显示</strong>
          <small>减少导航和列表间距，适合高频使用</small>
        </span>
      </label>
      <h3>个人记忆</h3>
      <p className="subtle">保留对协作有帮助的偏好。这里的调整会在当前浏览器中保存。</p>
      <label className="check-row">
        <input
          type="checkbox"
          checked={state.profile.autoMemory}
          onChange={(e) =>
            change((s) => {
              s.profile.autoMemory = e.target.checked;
            })
          }
        />
        <span>允许记住明确表达的低风险偏好（演示设置）</span>
      </label>
      <div className="memory-list">
        {state.memories.map((m) => (
          <div key={m.id}>
            <span>{m.text}</span>
            <Button
              variant="ghost"
              aria-label={`删除记忆${m.text}`}
              onClick={() =>
                ui.open({
                  kind: 'confirm',
                  title: '删除这条记忆',
                  text: m.text,
                  onConfirm: () => {
                    change((s) => {
                      s.memories = s.memories.filter((x) => x.id !== m.id);
                    });
                    ui.open({ kind: 'settings' });
                    ui.toast('这条记忆已移除');
                  },
                })
              }
            >
              <Trash2 size={15} />
            </Button>
          </div>
        ))}
      </div>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!memory.trim()) return;
          change((s) => s.memories.push({ id: uid(), text: memory.trim() }));
          setMemory('');
          ui.toast('协作偏好已保存');
        }}
      >
        <input
          aria-label="新增个人记忆"
          placeholder="添加一条明确的协作偏好"
          value={memory}
          maxLength={160}
          onChange={(e) => setMemory(e.target.value)}
        />
        <Button type="submit" disabled={!memory.trim()}>
          记住
        </Button>
      </form>
      <h3>已归档会话</h3>
      {state.chats.filter((c) => c.archived).length ? (
        state.chats
          .filter((c) => c.archived)
          .map((c) => (
            <div className="recent-row" key={c.id}>
              <span className="grow">{c.title}</span>
              <Button
                onClick={() => {
                  change((s) => {
                    s.chats.find((x) => x.id === c.id)!.archived = false;
                  });
                  ui.toast('会话已恢复到侧栏');
                }}
              >
                恢复会话
              </Button>
            </div>
          ))
      ) : (
        <p className="subtle">还没有已归档会话。</p>
      )}
      <div className="settings-reset">
        <div>
          <strong>重新体验 Demo</strong>
          <p>清除本浏览器中的空谷演示修改，恢复初始场景。旧版通用Demo数据保留。</p>
        </div>
        <Button
          icon={RotateCcw}
          onClick={() =>
            ui.open({
              kind: 'confirm',
              title: '重置演示数据',
              text: '这会清除本浏览器中空谷场景新增的会话、资料、应用与记录，恢复空谷初始示例。旧版通用Demo数据不受影响。此操作不可撤销。',
              onConfirm: () => {
                reset();
                ui.setNewDraft({ text: '', space: 'none', refs: [] });
                ui.briefingViews.current = {};
                ui.preview(null);
                ui.go('briefing');
                ui.toast('已恢复初始演示数据');
              },
            })
          }
        >
          重置
        </Button>
      </div>
    </div>
  );
}
