import { useEffect, useRef } from 'react';
import { MessageCircle, X } from 'lucide-react';
import { ArenaRoomChat, type ArenaChallengeTarget } from './ArenaRoomChat';
import type { ArenaChatGameCall } from '../lib/queries';

type Props = {
  roomId: string;
  userId: string;
  guestKey?: string;
  open: boolean;
  showLauncher: boolean;
  onOpenChange: (open: boolean) => void;
  allowGameCalls: boolean;
  challengeTargets?: ArenaChallengeTarget[];
  onGameCallCreated?: (gameCall: ArenaChatGameCall) => Promise<void> | void;
  onGameCallAction?: (gameCall: ArenaChatGameCall) => Promise<void> | void;
};

export function ArenaWitnessChatDrawer({
  roomId,
  userId,
  guestKey,
  open,
  showLauncher,
  onOpenChange,
  allowGameCalls,
  challengeTargets,
  onGameCallCreated,
  onGameCallAction,
}: Props) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeButtonRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onOpenChange, open]);

  return (
    <>
      {!open && showLauncher && (
        <button
          type="button"
          onClick={() => onOpenChange(true)}
          className="btn-primary fixed right-4 z-[2147483010] min-h-11 px-4 shadow-xl"
          style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }}
          aria-label="Open match chat"
        >
          <MessageCircle size={17} /> Chat
        </button>
      )}
      {open && (
        <div
          className="fixed inset-0 z-[2147483020] flex items-end justify-center bg-black/60 px-3 pt-3 backdrop-blur-sm sm:items-center"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)' }}
          onClick={(event) => { if (event.target === event.currentTarget) onOpenChange(false); }}
        >
          <section
            className="w-full max-w-lg max-h-[85dvh] overflow-y-auto rounded-lg border border-gold/40 bg-bg p-3 shadow-2xl sm:p-4"
            role="dialog"
            aria-modal="true"
            aria-label="Arena match chat"
          >
            <div className="mb-2 flex items-center justify-between gap-3 px-1">
              <h3 className="flex items-center gap-2 text-sm font-bold text-ink"><MessageCircle size={16} className="text-brass" /> Match chat</h3>
              <button ref={closeButtonRef} type="button" onClick={() => onOpenChange(false)} className="icon-btn h-8 w-8" title="Close match chat" aria-label="Close match chat"><X size={17} /></button>
            </div>
            <ArenaRoomChat
              roomId={roomId}
              userId={userId}
              guestKey={guestKey}
              compact
              allowGameCalls={allowGameCalls}
              challengeTargets={challengeTargets}
              onGameCallCreated={onGameCallCreated}
              onGameCallAction={onGameCallAction}
            />
          </section>
        </div>
      )}
    </>
  );
}
