import {
  createContext,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type SelectHTMLAttributes,
} from 'react';
import { Check, ChevronDown } from 'lucide-react';
import './select.css';

export const CustomSelectContext = createContext(false);
type Option = { value: string; label: string; disabled: boolean };
/** One styled control in the platform console; native form values and validation remain intact. */
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const custom = useContext(CustomSelectContext);
  return custom ? <CustomSelect {...props} /> : <select {...props} />;
}
function CustomSelect({
  children,
  className = '',
  style,
  onChange,
  onInvalid,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  const native = useRef<HTMLSelectElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<Option[]>([]);
  const [display, setDisplay] = useState('');
  const [label, setLabel] = useState<string>();
  const [active, setActive] = useState(0);
  const [invalid, setInvalid] = useState(false);
  const search = useRef({ text: '', at: 0 });
  // A parent fieldset may lock the control while its popover is already open.
  useLayoutEffect(() => {
    if (open && native.current?.matches(':disabled')) setOpen(false);
  });
  useLayoutEffect(() => {
    const element = native.current!;
    setDisplay(element.selectedOptions[0]?.text || '请选择');
    setLabel(props['aria-label'] || element.labels?.[0]?.textContent?.trim() || undefined);
    if (open) {
      setOptions(
        Array.from(element.options, (item) => ({
          value: item.value,
          label: item.text,
          disabled:
            item.disabled ||
            (item.parentElement instanceof HTMLOptGroupElement && item.parentElement.disabled),
        })),
      );
      setActive(Math.max(0, element.selectedIndex));
    }
  }, [children, props.value, props.defaultValue, props['aria-label'], open]);
  useLayoutEffect(() => {
    if (!open) return;
    const popup = panel.current!;
    popup.showPopover();
    const place = () => {
      const rect = trigger.current!.getBoundingClientRect();
      popup.style.minWidth = `${rect.width}px`;
      popup.style.maxWidth = `${innerWidth - 24}px`;
      const height = popup.offsetHeight;
      popup.style.left = `${Math.max(12, Math.min(rect.left, innerWidth - popup.offsetWidth - 12))}px`;
      popup.style.top = `${Math.max(12, rect.bottom + height + 8 < innerHeight ? rect.bottom + 6 : rect.top - height - 6)}px`;
    };
    const resize = new ResizeObserver(place);
    resize.observe(popup);
    place();
    const outside = (event: PointerEvent) => {
      if (!popup.contains(event.target as Node) && !trigger.current?.contains(event.target as Node))
        setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      resize.disconnect();
      popup.hidePopover();
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);
  useLayoutEffect(() => {
    if (open) panel.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open, options]);
  const choose = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    const element = native.current!;
    if (element.matches(':disabled')) {
      setOpen(false);
      return;
    }
    const changed = element.value !== option.value;
    element.value = option.value;
    setDisplay(option.label);
    setInvalid(false);
    setOpen(false);
    if (changed)
      onChange?.({
        target: element,
        currentTarget: element,
        type: 'change',
      } as ChangeEvent<HTMLSelectElement>);
    trigger.current?.focus();
  };
  const move = (step: number) => {
    for (let n = 1; n <= options.length; n++) {
      const index = (active + step * n + options.length) % options.length;
      if (!options[index].disabled) {
        setActive(index);
        break;
      }
    }
  };
  return (
    <span className={`app-select ${className}`} style={style}>
      <select
        {...props}
        ref={native}
        className="app-select-native"
        aria-hidden="true"
        tabIndex={-1}
        onChange={onChange}
        onInvalid={(event) => {
          event.preventDefault();
          setInvalid(true);
          trigger.current?.focus();
          onInvalid?.(event);
        }}
      >
        {children}
      </select>
      <button
        ref={trigger}
        type="button"
        className="app-select-trigger"
        role="combobox"
        aria-label={label}
        aria-labelledby={props['aria-labelledby']}
        aria-describedby={props['aria-describedby']}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        aria-invalid={invalid || props['aria-invalid']}
        aria-errormessage={props['aria-errormessage']}
        aria-required={props.required || undefined}
        disabled={props.disabled}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
            event.preventDefault();
            if (!open) {
              setOpen(true);
              return;
            }
            if (event.key === 'ArrowDown') move(1);
            else if (event.key === 'ArrowUp') move(-1);
            else if (event.key === 'Home')
              setActive(
                Math.max(
                  0,
                  options.findIndex((item) => !item.disabled),
                ),
              );
            else if (event.key === 'End') setActive(options.findLastIndex((item) => !item.disabled));
            else choose(active);
          } else if (event.key === 'Escape' && open) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          } else if (event.key === 'Tab') setOpen(false);
          else if (open && event.key.length === 1) {
            const now = Date.now();
            search.current.text = (now - search.current.at > 600 ? '' : search.current.text) + event.key;
            search.current.at = now;
            const index = options.findIndex(
              (item) =>
                !item.disabled && item.label.toLowerCase().startsWith(search.current.text.toLowerCase()),
            );
            if (index >= 0) setActive(index);
          }
        }}
      >
        <span>{display}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div
          ref={panel}
          popover="manual"
          className="app-select-popup"
          role="listbox"
          id={id}
          aria-label={label}
        >
          {options.map((option, index) => (
            <div
              key={`${option.value}-${index}`}
              role="option"
              id={`${id}-${index}`}
              data-index={index}
              aria-selected={native.current?.value === option.value}
              aria-disabled={option.disabled || undefined}
              className={`app-select-option ${index === active ? 'highlighted' : ''}`}
              onPointerMove={() => !option.disabled && setActive(index)}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => choose(index)}
            >
              <span>{option.label}</span>
              {native.current?.value === option.value && <Check size={15} aria-hidden="true" />}
            </div>
          ))}
        </div>
      )}
    </span>
  );
}
