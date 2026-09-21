import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Folder } from 'lucide-react';
import { visibleSpaces } from '../libraryModel';
import { useDemo, useUI } from '../store';

export function DraftSpacePicker() {
  const { state } = useDemo();
  const { newDraft, setNewDraft } = useUI();
  const choices = [{ id: 'none', name: '未归入空间' }, ...visibleSpaces(state)];
  const selected = Math.max(
    0,
    choices.findIndex((space) => space.id === newDraft.space),
  );
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(selected);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const show = (index = selected) => {
    setHighlight(index);
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  };
  const choose = (index: number) => {
    setNewDraft((draft) => ({ ...draft, space: choices[index].id }));
    close();
  };
  useLayoutEffect(() => {
    if (open) menu.current?.focus({ preventScroll: true });
  }, [open]);
  useLayoutEffect(() => {
    const list = menu.current;
    const option = list?.children[highlight] as HTMLElement | undefined;
    if (!open || !list || !option) return;
    if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight)
      list.scrollTop = option.offsetTop + option.offsetHeight - list.clientHeight;
  }, [open, highlight]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [open]);
  return (
    <div
      ref={root}
      className="draft-space-picker"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="context-button draft-space-trigger"
        aria-label="新会话归属"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => (open ? close() : show())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            show(event.key === 'ArrowUp' ? choices.length - 1 : selected);
          }
        }}
      >
        <Folder size={16} aria-hidden="true" />
        <span>{choices[selected].name}</span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {open && (
        <div
          ref={menu}
          id={id}
          className="draft-space-menu"
          role="listbox"
          aria-label="选择工作空间"
          aria-activedescendant={`${id}-${highlight}`}
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key === 'Tab') {
              close();
              return;
            }
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' ', 'Escape'].includes(event.key)) return;
            event.preventDefault();
            event.stopPropagation();
            if (event.key === 'Escape') close();
            else if (event.key === 'Enter' || event.key === ' ') choose(highlight);
            else
              setHighlight((current) =>
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? choices.length - 1
                    : (current + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length,
              );
          }}
        >
          {choices.map((space, index) => (
            <button
              key={space.id}
              id={`${id}-${index}`}
              type="button"
              role="option"
              aria-selected={index === selected}
              tabIndex={-1}
              className={index === highlight ? 'is-highlighted' : ''}
              onPointerMove={() => setHighlight(index)}
              onClick={() => choose(index)}
            >
              <Folder size={16} aria-hidden="true" />
              <span>{space.name}</span>
              {index === selected && <Check size={16} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
