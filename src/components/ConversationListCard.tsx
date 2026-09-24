import { useState } from 'react';
import { Search } from 'lucide-react';
import { useUI } from '../store';
import { DeckCard, type DeckCardProps } from './DeckCard';
import { ConversationList } from './ConversationList';
import { IconButton } from './ui';

type Props = Pick<DeckCardProps, 'active' | 'folded' | 'covered' | 'clipped' | 'onExpand'> & {
  onSelect?: () => void;
};
export function ConversationListCard({ onSelect, ...props }: Props) {
  const ui = useUI();
  const [, redraw] = useState(0);
  return (
    <DeckCard
      id="list"
      kind="list"
      label="会话列表卡片"
      width={ui.conversationListState.current.width}
      onWidth={(width) => {
        ui.conversationListState.current.width = width;
        redraw((value) => value + 1);
      }}
      tabLabel="会话列表"
      {...props}
    >
      <header className="deck-card-header">
        <strong>会话列表</strong>
        <IconButton icon={Search} label="搜索会话和资料" onClick={() => ui.open({ kind: 'search' })} />
      </header>
      <ConversationList onSelect={onSelect} />
    </DeckCard>
  );
}
