import { useEffect, useState, type RefObject } from 'react';
import { useDemo } from '../store';
import type { BriefingState, CardSize } from '../briefing';
import { layoutBriefingSpread, saveBriefingLayout, type BriefingEntry } from '../briefingLayout';
import { useBriefingEdit, useBriefingMove } from './BriefingMove';
import { useBriefingResize } from './BriefingResize';

type Preference = NonNullable<BriefingState['followLayouts']>[string];

// Follow is a personal board. Its sizes and placements never become source-card config.
export function useBriefingFollowLayout(options: {
  page: RefObject<HTMLDivElement | null>;
  columns: number;
  unit: number;
  viewKey: string;
  enabled: boolean;
  blocked: boolean;
  entries: BriefingEntry[];
}) {
  const { state, change } = useDemo();
  const owner = state.profile.name;
  const saved = state.briefing?.followLayouts?.[owner];
  const entries = options.entries
    .filter((entry) => !entry.card.hidden)
    .map((entry) => ({
      ...entry,
      card: { ...entry.card, config: undefined },
    }));
  const edit = useBriefingEdit(options.page, options.viewKey, options.blocked || !options.enabled);
  const [undo, setUndo] = useState<{ previous?: Preference; text: string } | null>(null);
  useEffect(() => {
    setUndo(null);
  }, [options.viewKey, owner]);
  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), 6000);
    return () => clearTimeout(timer);
  }, [undo]);
  const save = (next: Preference | undefined, text: string) => {
    if (!options.enabled || options.blocked) return;
    setUndo({ previous: saved, text });
    change((draft) => {
      const preferences = (draft.briefing!.followLayouts ||= {});
      if (next) preferences[owner] = next;
      else delete preferences[owner];
    });
  };
  const resize = useBriefingResize({
    ...options,
    onCommit: (id, size, position) => {
      const sizes = { ...saved?.sizes, [id]: size };
      const placements = layoutBriefingSpread(
        entries,
        options.columns,
        false,
        sizes,
        { id, row: position.row, col: position.col },
        saved?.layout,
      );
      save(
        {
          sizes,
          layout: saveBriefingLayout(placements, options.columns, [id, ...(saved?.layout.manual || [])]),
        },
        '大小已保存',
      );
    },
  });
  const move = useBriefingMove({
    ...options,
    blocked: !options.enabled || options.blocked || !!resize.preview,
    manual: () => saved?.layout.manual || [],
    placements: () =>
      layoutBriefingSpread(
        entries,
        options.columns,
        false,
        saved?.sizes,
        resize.layoutAnchor('following'),
        saved?.layout,
      ),
    onStart: () => resize.clearAnchors(),
    onTouchHold: () => edit.setEditing(true),
    onCommit: (preview) => {
      const sizes = saved?.sizes || {};
      const placements = layoutBriefingSpread(
        entries,
        options.columns,
        false,
        { ...sizes, [preview.id]: preview.size },
        preview,
        preview.baseline,
      );
      save(
        {
          sizes,
          layout: saveBriefingLayout(placements, options.columns, [
            preview.id,
            ...(preview.baseline.manual || []),
          ]),
        },
        '位置已保存',
      );
    },
  });
  const sizes: Record<string, CardSize> = { ...saved?.sizes };
  if (resize.preview) sizes[resize.preview.id] = resize.preview.size;
  if (move.preview) sizes[move.preview.id] = move.preview.size;
  const placements = options.enabled
    ? layoutBriefingSpread(
        entries,
        options.columns,
        false,
        sizes,
        move.preview || resize.layoutAnchor('following'),
        move.preview?.baseline || saved?.layout,
      )
    : [];
  const cancel = () => {
    move.cancel();
    resize.cancel();
    resize.clearAnchors();
  };
  return {
    resize,
    move,
    edit,
    placements,
    undo,
    hasLayout: !!saved,
    finishEditing: () => {
      cancel();
      edit.setEditing(false);
    },
    reset: () => {
      cancel();
      move.capture();
      save(undefined, '已恢复自动排列');
    },
    restore: () => {
      if (!undo) return;
      cancel();
      move.capture();
      change((draft) => {
        const preferences = (draft.briefing!.followLayouts ||= {});
        if (undo.previous) preferences[owner] = undo.previous;
        else delete preferences[owner];
      });
      setUndo(null);
    },
  };
}
