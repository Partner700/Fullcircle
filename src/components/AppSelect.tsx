import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '../lib/utils';

export type AppSelectOption = {
  value: string;
  label: string;
  description?: string;
};

export function AppSelect({
  value,
  options,
  onChange,
  placeholder = 'Select',
  className,
  buttonClassName,
  disabled = false,
}: {
  value: string;
  options: AppSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  buttonClassName?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [menuRect, setMenuRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selected = useMemo(() => options.find((option) => option.value === value), [options, value]);

  const updateMenuRect = () => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMenuRect({
      left: Math.max(12, Math.min(rect.left, window.innerWidth - rect.width - 12)),
      top: Math.min(rect.bottom + 7, window.innerHeight - 300),
      width: rect.width,
    });
  };

  useEffect(() => {
    if (!open) return;
    updateMenuRect();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onReposition = () => updateMenuRect();
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [open]);

  const menu = open && menuRect ? (
    <div
      ref={menuRef}
      role="listbox"
      style={{ left: menuRect.left, top: menuRect.top, width: menuRect.width }}
      className="fixed z-[2147482500] max-h-72 overflow-y-auto rounded-2xl border border-border-bright bg-surface/95 p-1.5 shadow-2xl backdrop-blur-xl animate-scale-in"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="option"
            aria-selected={active}
            onClick={() => {
              onChange(option.value);
              setOpen(false);
            }}
            className={cn(
              'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors',
              active ? 'bg-peri-soft text-ink' : 'text-stone hover:bg-surface-2 hover:text-ink',
            )}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-bold">{option.label}</span>
              {option.description && <span className="mt-0.5 block text-xs text-stone">{option.description}</span>}
            </span>
            <span className={cn('flex h-5 w-5 items-center justify-center rounded-full border', active ? 'border-peri bg-peri text-navy' : 'border-border-bright')}>
              {active && <Check size={12} />}
            </span>
          </button>
        );
      })}
    </div>
  ) : null;

  return (
    <>
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          updateMenuRect();
          setOpen((value) => !value);
        }}
        className={cn(
          'input-field flex min-h-[2.9rem] w-full items-center justify-between gap-3 text-left',
          'shadow-[inset_0_1px_0_color-mix(in_srgb,var(--color-peri)_18%,transparent),0_7px_18px_rgba(7,15,29,0.12)]',
          disabled && 'cursor-not-allowed opacity-55',
          buttonClassName,
        )}
      >
        <span className={cn('min-w-0 flex-1 truncate', !selected && 'text-stone-dim')}>
          {selected?.label || placeholder}
        </span>
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-peri-soft text-peri">
          <ChevronDown size={16} className={cn('transition-transform', open && 'rotate-180')} />
        </span>
      </button>
    </div>
    {typeof document === 'undefined' ? menu : menu && createPortal(menu, document.body)}
    </>
  );
}
