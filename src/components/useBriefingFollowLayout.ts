import { useEffect, useState, type RefObject } from 'react';
import { useDemo } from '../store';
import type { BriefingState, CardSize } from '../briefing';
import {
  layoutBriefingSpread,
  saveBriefingLayout,
  type BriefingEntry,
  type BriefingFit,
} from '../briefingLayout';
import { useBriefingEdit, useBriefingMove } from './BriefingMove';
import { useBriefingResize } from './BriefingResize';

type Preference = NonNullable<BriefingState['followLayouts']>[string];

// Follow is a personal board. Its sizes and placements never become source-card config.
type FollowOptions = {
  page: RefObject<HTMLDivElement | null>;
  columns: number;
  unit: number;
  viewKey: string;
  enabled: boolean;
  blocked: boolean;
  editingBlocked?: boolean;
  entries: BriefingEntry[];
  minimum?: BriefingFit;
  defaultSizes?: Record<string, CardSize>;
  reflowSelector?: string;
  cardSelector?: string;
  surfaceSelector?: string;
  dragLayerClass?: string;
};
export function useBriefingFollowLayout(options: FollowOptions) {
  const { state, change } = useDemo();
  const owner = state.profile.name;
  return usePersonalBriefingLayout({
    ...options,
    saved: state.briefing?.followLayouts?.[owner],
    owner,
    onSave: (next) =>
      change((draft) => {
        const preferences = (draft.briefing!.followLayouts ||= {});
        if (next) preferences[owner] = next;
        else delete preferences[owner];
      }),
  });
}
export type FollowPreference = Preference;
export function usePersonalBriefingLayout(
  options: FollowOptions & {
    saved?: Preference;
    owner: string;
    onSave: (next: Preference | undefined) => void | Promise<boolean>;
  },
) {
  const { saved, owner } = options;
  const baseSizes = { ...options.defaultSizes, ...saved?.sizes };
  const entries = options.entries
    .filter((entry) => !entry.card.hidden)
    .map((entry) => ({
      ...entry,
      card: { ...entry.card, config: undefined },
    }));
  const edit = useBriefingEdit(options.page, options.viewKey, (options.editingBlocked ?? options.blocked) || !options.enabled);
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
    const result = options.onSave(next);
    if (result instanceof Promise)
      void result.then((success) => {
        if (success) setUndo({ previous: saved, text });
      });
    else setUndo({ previous: saved, text });
  };
  // A measured minimum belongs to the previous shape. Let the new shape render
  // before measuring it again; otherwise a wide-card minimum also blocks tall cards.
  const resizingMinimum = (id: string) =>
    Object.fromEntries(Object.entries(options.minimum || {}).filter(([key]) => key !== id));
  const resize = useBriefingResize({
    ...options,
    onCommit: (id, size, position) => {
      const sizes = { ...baseSizes, [id]: size };
      const placements = layoutBriefingSpread(
        entries,
        options.columns,
        false,
        sizes,
        { id, row: position.row, col: position.col },
        saved?.layout,
        false,
        resizingMinimum(id),
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
        baseSizes,
        resize.layoutAnchor('following'),
        saved?.layout,
        false,
        resize.preview ? resizingMinimum(resize.preview.id) : options.minimum,
      ),
    onStart: () => resize.clearAnchors(),
    onTouchHold: () => edit.setEditing(true),
    onCommit: (preview) => {
      const sizes = baseSizes;
      const placements = layoutBriefingSpread(
        entries,
        options.columns,
        false,
        { ...sizes, [preview.id]: preview.size },
        preview,
        preview.baseline,
        false,
        options.minimum,
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
  const sizes: Record<string, CardSize> = { ...baseSizes };
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
        false,
        resize.preview ? resizingMinimum(resize.preview.id) : options.minimum,
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
    requestedSizes: sizes,
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
      options.onSave(undo.previous);
      setUndo(null);
    },
  };
}
