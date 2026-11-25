import { Bookmark } from 'lucide-react';
import { createPortal } from 'react-dom';
export type ReadingOrigin = { date: string; reference: string };
export function ScriptureBookmark({ count, onBack }: { count:number; onBack?:()=>void }) {
  if(typeof document==='undefined') return null;
  return createPortal(<>
    <style>{'body:has([data-scripture-bookmark]) .hidden-items-shortcut { display: none !important; }'}</style>
    <button data-scripture-bookmark type="button" disabled={!count || !onBack} onClick={onBack}
      aria-label={count ? 'Return to previous Scripture passage' : 'No previous Scripture passage'}
      title={count ? 'Return one step through the Scripture trail' : 'Follow a thread to create a return bookmark'}
      className="fixed bottom-20 right-3 z-[65] flex h-11 w-11 items-center justify-center rounded-full border border-gold/45 bg-navy-2 text-gold shadow-xl disabled:opacity-60 md:bottom-6 md:right-6">
      <Bookmark size={20} fill={count?'currentColor':'none'} />
      {count>0&&<span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-gold px-1 text-[10px] font-black text-navy">{count}</span>}
    </button>
  </>,document.body);
}
