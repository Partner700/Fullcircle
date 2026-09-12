import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookOpenCheck, Coins, Loader2, Shield, Swords, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { fetchPanelImageSetting, fetchProfileCv } from '../lib/queries';
import { OPEN_PROFILE_CV_EVENT } from '../lib/profileCv';
import type { PanelImageSetting, ProfileCvData } from '../lib/types';
import { formatDenarii } from '../lib/utils';
import { ChiRhoMark } from './ChiRhoMark';
import { PanelImageBackdrop } from './PanelImageBackdrop';
import { TentHouseSymbol } from './TentHouseSymbol';
import { UserAvatar } from './UserAvatar';

function ProfileMeasure({
  icon: Icon,
  value,
  label,
  explanation,
  accent,
}: {
  icon: typeof Coins;
  value: string;
  label: string;
  explanation: string;
  accent: string;
}) {
  return (
    <article className="profile-cv-measure">
      <span className="profile-cv-measure-icon" style={{ color: accent, backgroundColor: `${accent}1f` }}>
        <Icon size={15} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] font-black uppercase text-stone">{label}</span>
        <strong className="profile-cv-value block font-display font-black text-ink">{value}</strong>
      </span>
      <span className="profile-cv-explanation text-stone">{explanation}</span>
    </article>
  );
}

export function ProfileCvHost() {
  const { profile } = useAuth();
  const [targetId, setTargetId] = useState<string | null>(null);
  const [data, setData] = useState<ProfileCvData | null>(null);
  const [artwork, setArtwork] = useState<PanelImageSetting | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setTargetId(null);
    setData(null);
    setError('');
  }, []);

  useEffect(() => {
    const open = (event: Event) => {
      const requested = (event as CustomEvent<{ userId?: string | null }>).detail?.userId;
      if (!profile?.id) return;
      setTargetId(requested || profile.id);
    };
    window.addEventListener(OPEN_PROFILE_CV_EVENT, open);
    return () => window.removeEventListener(OPEN_PROFILE_CV_EVENT, open);
  }, [profile?.id]);

  useEffect(() => {
    if (!targetId) return;
    let active = true;
    setLoading(true);
    setError('');
    setData(null);
    void fetchProfileCv(targetId)
      .then((result) => { if (active) setData(result); })
      .catch(() => { if (active) setError('This profile could not be opened. Please try again.'); })
      .finally(() => { if (active) setLoading(false); });
    void fetchPanelImageSetting('meditation')
      .then((result) => { if (active) setArtwork(result); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [targetId]);

  useEffect(() => {
    if (!targetId) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
      if (event.key === 'Tab') {
        event.preventDefault();
        closeButtonRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus({ preventScroll: true });
    };
  }, [close, targetId]);

  if (!targetId || typeof document === 'undefined') return null;

  return createPortal(
    <div className="profile-cv-overlay fixed inset-0 z-[2147483500] flex items-center justify-center bg-navy/72 p-3 backdrop-blur-sm animate-fade-in" onClick={close}>
      <section
        className="profile-cv-panel relative isolate w-full overflow-auto rounded-lg border border-border-bright bg-bg shadow-2xl animate-fade-in"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={data ? `${data.display_name}'s profile` : 'Full Circle profile'}
      >
        <PanelImageBackdrop image={artwork} opacityFallback={24} veilClassName="profile-cv-veil" />
        <header className="profile-cv-header relative z-10 flex items-center justify-between border-b border-border">
          <p className="text-[10px] font-bold uppercase text-stone">Full Circle Profile</p>
          <button ref={closeButtonRef} type="button" onClick={close} className="icon-btn" aria-label="Close profile"><X size={17} /></button>
        </header>

        <div className="profile-cv-body relative z-10">
          {loading ? (
            <div className="flex min-h-[12rem] flex-col items-center justify-center gap-3 text-stone">
              <Loader2 size={24} className="animate-spin text-gold" />
              <p className="text-xs font-semibold">Opening profile</p>
            </div>
          ) : error ? (
            <div className="flex min-h-[12rem] items-center justify-center text-center text-sm text-coral">{error}</div>
          ) : data ? (
            <>
              <div className="profile-cv-identity">
                <UserAvatar userId={data.user_id} name={data.display_name} avatarUrl={data.avatar_url} className="profile-cv-avatar shrink-0 border border-border-bright" loading="eager" />
                <div className="min-w-0 flex-1">
                  <h2 className="profile-cv-name font-display font-bold text-ink">{data.display_name}</h2>
                  <p className="mt-1 text-[10px] font-semibold capitalize text-stone">{data.role}</p>
                  <div className="mt-1 flex items-center gap-1.5">
                    {data.tent_house_id && <TentHouseSymbol houseId={data.tent_house_id} size={16} />}
                    {data.tent_name && <span className="min-w-0 break-words text-[10px] font-semibold text-stone">{data.tent_name}</span>}
                  </div>
                </div>
                <div className="profile-cv-marks">
                  <ChiRhoMark size={19} className="text-peri" />
                  <strong className="profile-cv-value font-display font-bold text-ink">{data.marks.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong>
                  <span className="text-[9px] leading-tight text-stone">Valediction marks</span>
                </div>
              </div>

              <div className="profile-cv-measures">
                <ProfileMeasure icon={BookOpenCheck} label="Streak" value={`${data.current_streak} days`} explanation="Days the Bible has been read consistently" accent="#ef6a4d" />
                <ProfileMeasure icon={Shield} label="Figs" value={data.total_figs.toLocaleString()} explanation="Bible questions answered correctly" accent="#7c8cff" />
                <ProfileMeasure icon={Swords} label="Rhudes" value={data.rhudes.toLocaleString()} explanation="Bible duels won" accent="#5bad7f" />
                <ProfileMeasure icon={Coins} label="Denarii" value={formatDenarii(data.total_denarii)} explanation="Coins earned from daily Bible interactions" accent="#f5b731" />
              </div>

              <p className="profile-cv-footer text-[10px] text-stone">
                Resident since {new Date(data.member_since).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
              </p>
            </>
          ) : null}
        </div>
      </section>
    </div>,
    document.body,
  );
}
