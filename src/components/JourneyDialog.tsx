import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function JourneyDialog({ label, children, onClose }: { label: string; children: ReactNode; onClose?: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && close.current) { event.preventDefault(); close.current(); }
      if (event.key !== 'Tab') return;
      const items = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]') || [])];
      const first = items[0], last = items[items.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first.focus(); }
    };
    const element = panel.current;
    element?.addEventListener('keydown', onKey);
    return () => { element?.removeEventListener('keydown', onKey); if (previous?.isConnected) previous.focus(); };
  }, []);
  return createPortal(<div className="fixed inset-0 z-[2147483000] flex items-center justify-center bg-black/65 p-3" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
    <div ref={panel} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} className="max-h-[88dvh] w-full max-w-md overflow-y-auto rounded-lg border border-brass/60 bg-surface p-4 shadow-2xl outline-none">{children}</div>
  </div>, document.body);
}
