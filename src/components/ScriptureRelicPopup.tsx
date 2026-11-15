import { useEffect, useId, useRef, useState } from 'react';
import { fetchEditionVerses } from '../lib/scriptureEditions';

export function ScriptureRelicPopup({ reference, passage, onClose }: {
  reference: string;
  passage?: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  const close = useRef(onClose);
  close.current = onClose;
  const [text, setText] = useState(passage);

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    const timeout = window.setTimeout(() => close.current(), 10_000);
    return () => {
      window.clearTimeout(timeout);
      if (element?.open) element.close();
    };
  }, []);

  useEffect(() => {
    if (passage) return;
    const refs = reference.split(/\s*·\s*/).flatMap((entry) => {
      const match = entry.match(/^(.+?\s+\d+:)(\d+)(?:\s*[-–]\s*(\d+))?$/);
      if (!match) {
        return /^.+?\s+\d+$/.test(entry) ? [entry + ':1'] : [];
      }
      const first = Number(match[2]);
      const last = Number(match[3] || match[2]);
      return Array.from({ length: Math.max(0, Math.min(20, last - first + 1)) }, (_, i) => match[1] + (first + i));
    });
    if (!refs.length) return;
    const abort = new AbortController();
    void fetchEditionVerses('web', refs, abort.signal).then(({ translations }) => {
      if (!abort.signal.aborted && translations.size) {
        setText(refs.flatMap(ref => translations.has(ref) ? [ref + '  ' + translations.get(ref)] : []).join('\n\n'));
      }
    });
    return () => abort.abort();
  }, [passage, reference]);

  return (
    <dialog ref={dialog} aria-labelledby={heading} onCancel={(event) => event.preventDefault()}
      className="card fixed inset-0 m-auto max-h-[80dvh] w-[min(92vw,36rem)] overflow-y-auto p-5 text-ink backdrop:bg-black/70">
      <h2 id={heading} className="font-display text-xl font-bold">{reference}</h2>
      <p className="mt-1 text-sm text-gold">Question timer paused for 10 seconds</p>
      {text && <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed">{text}</p>}
    </dialog>
  );
}
