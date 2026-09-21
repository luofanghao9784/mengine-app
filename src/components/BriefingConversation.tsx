import { BriefingCardPeople } from './BriefingMedia';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { useDemo, useUI } from '../store';
import { addMessage, resolveRequest, spaceName, type Chat } from '../model';
import { cardConfig, cardSizes, type CardSize } from '../briefing';
import { BriefingCardBody } from '../pages/Briefing';
import { libraryPath, locationNames } from '../libraryModel';
import { Button, Field } from './ui';
import { SourceLinks } from './SourceDetails';

export function BriefingConversation({ chat }: { chat: Chat }) {
  const { state, change } = useDemo();
  const ui = useUI();
  const ctx = chat.briefingContext!;
  const card = state.briefing?.cards.find((c) => c.id === ctx.cardId && c.active);
  const r =
    ctx.snapshot.sourceKind === 'request'
      ? state.requests.find((r) => r.id === ctx.snapshot.sourceId)
      : undefined;
  if (!card) return <p className="subtle">当前来源已不可用，历史会话保留。</p>;
  if (ctx.purpose === 'optimize') {
    const config = ctx.draft || cardConfig(card);
    const update = (patch: Partial<typeof config>) =>
      change((s) => {
        const context = s.chats.find((c) => c.id === chat.id)!.briefingContext!;
        context.draft = { ...config, ...patch };
      });
    return (
      <section className="collaboration-card briefing-optimizer" aria-label="卡片优化配置">
        <div className="card-heading">
          <strong>让这张卡片更适合你</strong>
          <span className="subtle">预览后保存</span>
        </div>
        <Field label="卡片标题">
          <input value={config.title} maxLength={28} onChange={(e) => update({ title: e.target.value })} />
        </Field>
        <Field label="卡片尺寸">
          <select
            aria-label="卡片尺寸"
            value={config.size}
            onChange={(e) => update({ size: e.target.value as CardSize })}
          >
            {cardSizes.map((size) => (
              <option key={size}>{size}</option>
            ))}
          </select>
        </Field>
        <label className="check-row">
          <input
            type="checkbox"
            checked={config.compact}
            onChange={(e) => update({ compact: e.target.checked })}
          />
          精简展示（保留事实与依据）
        </label>
        <div
          className={`briefing-config-preview briefing-card template-${card.data.template}`}
          data-size={config.size}
        >
          <div className="briefing-card-main">
            <BriefingCardBody data={card.data} config={config} at={card.updatedAt} />
          </div>
          <BriefingCardPeople data={card.data} />
        </div>
        <div className="row wrap">
          <Button
            variant="primary"
            icon={Sparkles}
            disabled={!config.title.trim()}
            onClick={() => {
              change((s) => {
                s.briefing!.cards.find((c) => c.id === card.id)!.config = {
                  ...config,
                  title: config.title.trim(),
                };
                addMessage(
                  s.chats.find((c) => c.id === chat.id)!,
                  'assistant',
                  `已保存「${config.title.trim()}」：${config.size}，${config.compact ? '精简' : '完整'}展示。结果与时间排序保持不变。`,
                );
              });
              ui.toast('卡片样式已保存');
            }}
          >
            保存卡片样式
          </Button>
          <Button icon={ArrowLeft} onClick={ui.returnToBriefing}>
            返回智能画报
          </Button>
        </div>
      </section>
    );
  }
  const requestLocation = () => {
    try {
      return locationNames(state, r!.target, r!.targetFolderId).join(' / ');
    } catch {
      return '目标位置已不可用';
    }
  };
  return (
    <section className="briefing-chat-context" aria-label="画报上下文与建议">
      <SourceLinks links={ctx.snapshot.sourceLinks} />
      {card.updatedAt !== ctx.asOf && (
        <p className="briefing-context-warning">
          来源已有更新，上方讨论仍保留当时内容。下方事项操作使用当前状态。
        </p>
      )}
      {r && (
        <div className="collaboration-card briefing-request">
          <div className="card-heading">
            <strong>{r.title}</strong>
            <span>{r.status === 'pending' ? '等待授权' : r.status === 'approved' ? '已批准' : '已拒绝'}</span>
          </div>
          <p>
            申请共享到{r.kind === 'material' ? requestLocation() : spaceName(state, r.target)}，查看范围为
            {r.visibility}。
          </p>
          <p className="subtle">
            负责人：{state.spaces.find((s) => s.id === r.target)?.owner} ·{' '}
            {r.kind === 'app' ? '应用发布' : `资料入库 v${r.version?.number}`}
          </p>
          {r.status === 'pending' && (
            <div className="approval-simulation">
              <span>负责人视角 · 演示</span>
              <div className="row wrap">
                <Button
                  variant="primary"
                  onClick={() =>
                    ui.open({
                      kind: 'confirm',
                      title: '模拟负责人批准',
                      text: `批准「${r.title}」共享到${r.kind === 'material' ? requestLocation() : spaceName(state, r.target)}。发布申请时的${r.kind === 'app' ? '应用配置' : ` v${r.version?.number} 内容`}，后续个人修改不会自动同步。`,
                      onConfirm: () => {
                        try {
                          change((s) => resolveRequest(s, r.id, true));
                          ui.toast('已模拟批准，成果已进入目标空间');
                        } catch (e) {
                          ui.toast((e as Error).message);
                        }
                      },
                    })
                  }
                >
                  模拟批准
                </Button>
                <Button
                  onClick={() =>
                    ui.open({
                      kind: 'confirm',
                      title: '拒绝这项申请',
                      text: '个人草稿会保留，目标空间不产生变更。',
                      onConfirm: () => {
                        change((s) => resolveRequest(s, r.id, false));
                        ui.toast('已拒绝申请，个人草稿保留');
                      },
                    })
                  }
                >
                  拒绝申请
                </Button>
              </div>
            </div>
          )}
          {r.status === 'approved' && (
            <Button
              onClick={() =>
                ui.go(r.kind === 'app' ? `apps/${r.target}` : libraryPath(r.target, r.targetFolderId))
              }
            >
              查看共享结果
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
