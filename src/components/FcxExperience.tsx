import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, Camera, Clock3, Image as ImageIcon, Loader2, Ticket, Trash2, UserPlus, Users, X } from 'lucide-react';
import { AppSelect } from './AppSelect';
import { AvatarCropDialog } from './ProfilePhotoEditor';
import {
  addFcxRegistration,
  fetchActiveFcxExperience,
  fetchAwards,
  fetchAllProfiles,
  fetchPreviousMuralis,
  removeFcxRegistration,
  saveFcxExperience,
  uploadFcxGuestAvatar,
} from '../lib/queries';
import { cn, formatXaf, getAppDateTimeMs, getTodayISODate } from '../lib/utils';
import { publicAsset } from '../lib/publicAsset';
import type { AwardWithRecipient, FcxExperience, Profile } from '../lib/types';
import { TentHouseSymbol } from './TentHouseSymbol';
import { VallumAvatarBadge } from './VallumAvatarBadge';

const FCX_START_HOUR = 12;

function readableError(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return fallback;
}

function eventDateLabel(experience: FcxExperience) {
  const date = experience.event_date || experience.event_month;
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', {
    month: 'long',
    day: experience.event_date ? 'numeric' : undefined,
    year: 'numeric',
  });
}

function countdownParts(targetDate: string, nowMs: number) {
  const remainingSeconds = Math.max(0, Math.floor((getAppDateTimeMs(targetDate, FCX_START_HOUR) - nowMs) / 1000));
  const days = Math.floor(remainingSeconds / 86400);
  const hours = Math.floor((remainingSeconds % 86400) / 3600);
  const minutes = Math.floor((remainingSeconds % 3600) / 60);
  const seconds = remainingSeconds % 60;
  return [
    { label: 'days', shortLabel: 'd', value: days },
    { label: 'hours', shortLabel: 'h', value: hours },
    { label: 'minutes', shortLabel: 'm', value: minutes },
    { label: 'seconds', shortLabel: 's', value: seconds },
  ];
}

export function FcxExperienceSlide({ experience, active }: { experience: FcxExperience; active: boolean }) {
  const [visibleExperience, setVisibleExperience] = useState(experience);
  const [animatedPercent, setAnimatedPercent] = useState(0);
  const [countdownNow, setCountdownNow] = useState(() => Date.now());
  const [previousWinner, setPreviousWinner] = useState<AwardWithRecipient | null>(null);
  const displayTitle = visibleExperience.title.replace(/\s*\(FCX\)\s*/gi, ' ').trim() || 'Full Circle Experience';
  const registrations = visibleExperience.registrations || [];
  const occupied = Math.min(registrations.length, visibleExperience.capacity);
  const targetPercent = Math.min(100, (occupied / Math.max(visibleExperience.capacity, 1)) * 100);
  const seats = Array.from({ length: visibleExperience.capacity }, (_, index) => registrations[index] || null);
  const countdownDate = visibleExperience.event_date || visibleExperience.event_month;
  const eventIsToday = countdownDate === getTodayISODate();
  const eventHasStarted = getAppDateTimeMs(countdownDate, FCX_START_HOUR) <= countdownNow;
  const countdown = useMemo(
    () => countdownParts(countdownDate, countdownNow),
    [countdownDate, countdownNow],
  );

  useEffect(() => {
    setVisibleExperience(experience);
  }, [experience]);

  useEffect(() => {
    if (!active) return;
    setCountdownNow(Date.now());
    const interval = window.setInterval(() => setCountdownNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [active, countdownDate]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    void fetchActiveFcxExperience()
      .then((latestExperience) => {
        if (!cancelled && latestExperience?.id === experience.id) {
          setVisibleExperience(latestExperience);
        }
      })
      .catch(() => undefined);

    return () => { cancelled = true; };
  }, [active, experience.id]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void fetchPreviousMuralis(visibleExperience.event_month)
      .catch(async () => {
        const awards = await fetchAwards();
        return awards.find((award) => (
          award.title.trim().toLowerCase() === 'muralis'
          && award.award_month.slice(0, 7) < visibleExperience.event_month.slice(0, 7)
        )) || null;
      })
      .then((winner) => { if (!cancelled) setPreviousWinner(winner); })
      .catch(() => { if (!cancelled) setPreviousWinner(null); });
    return () => { cancelled = true; };
  }, [active, visibleExperience.event_month]);

  useEffect(() => {
    setAnimatedPercent(0);
    if (!active || targetPercent <= 0) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setAnimatedPercent(targetPercent);
      return;
    }

    let animationFrame = 0;
    let startedAt: number | null = null;
    const duration = 1000;
    const animate = (timestamp: number) => {
      if (startedAt === null) startedAt = timestamp;
      const progress = Math.min(1, (timestamp - startedAt) / duration);
      const easedProgress = 1 - Math.pow(1 - progress, 3);
      setAnimatedPercent(targetPercent * easedProgress);
      if (progress < 1) {
        animationFrame = window.requestAnimationFrame(animate);
      } else {
        setAnimatedPercent(targetPercent);
      }
    };

    animationFrame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [active, targetPercent]);

  return (
    <div className="fcx-slide-content w-full max-w-2xl pr-1">
      <div className="flex items-start justify-between gap-5">
        <div className="flex min-w-0 items-center gap-2.5" aria-label={`${displayTitle}, FCX`}>
          <img
            src={publicAsset('icons/fullcircle-dove-clean.png')}
            alt=""
            className="h-8 w-8 shrink-0 object-contain drop-shadow-sm"
          />
          <span className="max-w-[11rem] text-left text-[11px] font-black uppercase leading-snug text-ink">
            {displayTitle} <span className="whitespace-nowrap text-[#ffd400] drop-shadow-sm">(FCX)</span>
          </span>
        </div>
        <div className="flex-shrink-0 text-right">
          <p className="text-xl font-bold text-ink">{occupied}/{visibleExperience.capacity}</p>
          <p className="text-[10px] font-semibold uppercase text-stone">spaces filled</p>
        </div>
      </div>

      <div className="mt-4 min-w-0">
        <p className="eyebrow flex items-center gap-1.5"><Ticket size={14} /> Monthly Experience</p>
        <p className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs font-semibold text-stone">
          <CalendarDays size={13} /> {eventDateLabel(visibleExperience)}
          <span>· 12:00 PM</span>
          {visibleExperience.ticket_price_xaf != null && <span>· {formatXaf(visibleExperience.ticket_price_xaf)}</span>}
        </p>
      </div>

      <div className="fcx-line mt-2.5 inline-flex min-h-12 max-w-full items-center gap-2.5 rounded-lg border border-white/25 bg-surface/55 px-3 py-2 shadow-sm backdrop-blur-md">
        <Clock3 size={17} className="shrink-0 text-brass" />
        {eventHasStarted ? (
          <p className="text-sm font-bold text-ink">{eventIsToday ? 'FCX is underway' : 'FCX has begun'}</p>
        ) : (
          <>
            <span className="text-[10px] font-bold uppercase text-stone">Starts in</span>
            <div className="grid grid-cols-4 gap-1.5" aria-label={`FCX starts in ${countdown.map((part) => `${part.value} ${part.label}`).join(', ')}`}>
              {countdown.map((part) => (
                <span key={part.label} className="min-w-8 whitespace-nowrap text-center text-base font-black tabular-nums leading-none text-ink">
                  {String(part.value).padStart(2, '0')}<span className="ml-0.5 text-[9px] font-bold text-stone">{part.shortLabel}</span>
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      <div
        className="fcx-line relative mt-3 h-3 overflow-hidden rounded-full border border-white/25 bg-surface/45 p-[2px] shadow-inner"
        role="progressbar"
        aria-label="FCX paid spaces"
        aria-valuemin={0}
        aria-valuemax={visibleExperience.capacity}
        aria-valuenow={occupied}
        aria-valuetext={`${occupied} of ${visibleExperience.capacity} spaces filled`}
      >
        <div
          className="fcx-progress-fill h-full rounded-full will-change-[width]"
          style={{ width: `${animatedPercent}%` }}
        />
      </div>

      <div className="mt-3 grid max-w-[19rem] grid-cols-10 gap-1.5" aria-label={`${occupied} of ${visibleExperience.capacity} FCX spaces filled`}>
        {seats.map((registration, index) => (
          <div
            key={registration?.id || `open-${index}`}
            title={registration ? `${registration.display_name} · paid ${registration.payment_source === 'app' ? 'in app' : 'externally'}` : 'Open FCX space'}
            className={cn(
              'fcx-seat-line relative flex h-6 w-6 items-center justify-center rounded-full',
              registration
                ? 'text-[9px] font-bold text-gold'
                : '',
            )}
          >
            <span className={cn('flex h-full w-full items-center justify-center overflow-hidden rounded-full border shadow-sm', registration ? 'border-brass/55 bg-navy/78' : 'border-white/30 bg-surface/35')}>
              {registration?.avatar_url ? (
                <img src={registration.avatar_url} alt={registration.display_name} className="h-full w-full object-cover" loading="lazy" />
              ) : registration ? (
                <span>{registration.display_name.charAt(0).toUpperCase()}</span>
              ) : (
                <img src={publicAsset('icons/fullcircle-dove-clean.png')} alt="" className="h-3.5 w-3.5 object-contain opacity-45" />
              )}
            </span>
            <VallumAvatarBadge userId={registration?.user_id} size="xs" />
          </div>
        ))}
      </div>

      {previousWinner?.profiles && (
        <div className="fcx-line mt-3 flex items-center gap-2.5 rounded-lg border border-white/20 bg-surface/45 px-2.5 py-2 backdrop-blur-sm">
          <span className="relative inline-flex shrink-0">
            <img
              src={previousWinner.profiles.avatar_url || publicAsset('icons/fullcircle-dove-clean.png')}
              alt={previousWinner.profiles.display_name}
              className="h-8 w-8 rounded-full border border-brass/55 object-cover"
            />
            <VallumAvatarBadge userId={previousWinner.user_id} size="sm" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase text-stone">Last month's experience</p>
            <p className="truncate text-xs font-black text-ink">Muralis · {previousWinner.profiles.display_name}</p>
          </div>
          {previousWinner.recipient_tent?.tent_house_id && (
            <TentHouseSymbol houseId={previousWinner.recipient_tent.tent_house_id} size={22} />
          )}
        </div>
      )}
    </div>
  );
}

export function FcxExperienceManager({ onEditArtwork }: { onEditArtwork: () => void }) {
  const guestPhotoInputRef = useRef<HTMLInputElement>(null);
  const defaultMonth = getTodayISODate().slice(0, 7);
  const [experience, setExperience] = useState<FcxExperience | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [title, setTitle] = useState('Full Circle Experience (FCX)');
  const [eventMonth, setEventMonth] = useState(defaultMonth);
  const [eventDate, setEventDate] = useState('');
  const [ticketPrice, setTicketPrice] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [paymentSource, setPaymentSource] = useState<'app' | 'external'>('app');
  const [guestName, setGuestName] = useState('');
  const [guestPhoto, setGuestPhoto] = useState<File | null>(null);
  const [guestPhotoPreview, setGuestPhotoPreview] = useState('');
  const [guestCropFile, setGuestCropFile] = useState<File | null>(null);
  const [guestPhotoTarget, setGuestPhotoTarget] = useState<{ kind: 'new' } | { kind: 'existing'; guestName: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [active, allProfiles] = await Promise.all([
        fetchActiveFcxExperience(),
        fetchAllProfiles(),
      ]);
      setExperience(active);
      setProfiles(allProfiles);
      if (active) {
        setTitle(active.title);
        setEventMonth(active.event_month.slice(0, 7));
        setEventDate(active.event_date || '');
        setTicketPrice(active.ticket_price_xaf == null ? '' : String(active.ticket_price_xaf));
      }
    } catch (error) {
      console.error('FCX manager load error:', error);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!guestPhoto) {
      setGuestPhotoPreview('');
      return;
    }
    const objectUrl = URL.createObjectURL(guestPhoto);
    setGuestPhotoPreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [guestPhoto]);

  const registeredUserIds = useMemo(
    () => new Set((experience?.registrations || []).map((entry) => entry.user_id).filter(Boolean)),
    [experience],
  );
  const memberOptions = useMemo(() => [
    { value: '', label: 'Choose an app member' },
    ...profiles
      .filter((profile) => !registeredUserIds.has(profile.id))
      .sort((left, right) => left.display_name.localeCompare(right.display_name))
      .map((profile) => ({ value: profile.id, label: profile.display_name })),
  ], [profiles, registeredUserIds]);

  const saveEvent = async () => {
    if (!eventMonth) return;
    setSaving(true);
    try {
      await saveFcxExperience({
        eventId: experience?.event_month.slice(0, 7) === eventMonth ? experience.id : null,
        eventMonth: `${eventMonth}-01`,
        eventDate: eventDate || null,
        title: title.trim() || 'Full Circle Experience (FCX)',
        capacity: 30,
        ticketPriceXaf: ticketPrice.trim() ? Number(ticketPrice) : null,
      });
      await load();
    } catch (error: unknown) {
      alert(readableError(error, 'Could not save FCX details.'));
    }
    setSaving(false);
  };

  const addMember = async () => {
    if (!experience || !selectedUserId) return;
    setSaving(true);
    try {
      await addFcxRegistration({
        eventId: experience.id,
        userId: selectedUserId,
        paymentSource,
      });
      setSelectedUserId('');
      await load();
    } catch (error: unknown) {
      alert(readableError(error, 'Could not add this FCX attendee.'));
    }
    setSaving(false);
  };

  const addGuest = async () => {
    if (!experience || !guestName.trim()) return;
    setSaving(true);
    try {
      const guestAvatarUrl = guestPhoto
        ? await uploadFcxGuestAvatar(experience.id, guestPhoto)
        : null;
      await addFcxRegistration({
        eventId: experience.id,
        guestName: guestName.trim(),
        guestAvatarUrl,
        paymentSource: 'external',
      });
      setGuestName('');
      setGuestPhoto(null);
      await load();
    } catch (error: unknown) {
      alert(readableError(error, 'Could not add this external attendee.'));
    }
    setSaving(false);
  };

  const chooseGuestPhoto = (target: { kind: 'new' } | { kind: 'existing'; guestName: string }) => {
    setGuestPhotoTarget(target);
    guestPhotoInputRef.current?.click();
  };

  const saveGuestCrop = async (file: File) => {
    if (!experience || !guestPhotoTarget) return;
    if (guestPhotoTarget.kind === 'new') {
      setGuestPhoto(file);
      setGuestCropFile(null);
      setGuestPhotoTarget(null);
      return;
    }

    setSaving(true);
    try {
      const guestAvatarUrl = await uploadFcxGuestAvatar(experience.id, file);
      await addFcxRegistration({
        eventId: experience.id,
        guestName: guestPhotoTarget.guestName,
        guestAvatarUrl,
        paymentSource: 'external',
      });
      setGuestCropFile(null);
      setGuestPhotoTarget(null);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const removeRegistration = async (registrationId: string, displayName: string) => {
    if (!window.confirm(`Remove ${displayName} from the paid FCX list?`)) return;
    setSaving(true);
    try {
      await removeFcxRegistration(registrationId);
      await load();
    } catch (error: unknown) {
      alert(readableError(error, 'Could not remove this FCX attendee.'));
    }
    setSaving(false);
  };

  const occupied = experience?.registrations.length || 0;
  const percent = Math.round((occupied / 30) * 100);

  return (
    <div className="card p-5 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-peri-soft text-peri">
            <Ticket size={22} />
          </div>
          <div>
            <h3 className="font-display text-lg font-semibold text-ink">Full Circle Experience</h3>
            <p className="text-sm text-stone">Manage the 30 paid spaces shown on the welcome panel.</p>
          </div>
        </div>
        <button type="button" onClick={onEditArtwork} className="btn-secondary text-xs">
          <ImageIcon size={14} /> FCX Artwork
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-5"><Loader2 size={20} className="animate-spin text-brass" /></div>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-4">
            <label className="md:col-span-2">
              <span className="mb-1 block text-xs text-stone">Event title</span>
              <input className="input-field" value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label>
              <span className="mb-1 block text-xs text-stone">Event month</span>
              <input type="month" className="input-field" value={eventMonth} onChange={(event) => setEventMonth(event.target.value)} />
            </label>
            <label>
              <span className="mb-1 block text-xs text-stone">Event date · starts at 12:00 PM</span>
              <input type="date" className="input-field" value={eventDate} onChange={(event) => setEventDate(event.target.value)} />
            </label>
            <label className="md:col-span-2">
              <span className="mb-1 block text-xs text-stone">Ticket price (XAF)</span>
              <input type="number" min="0" className="input-field" value={ticketPrice} onChange={(event) => setTicketPrice(event.target.value)} placeholder="Optional" />
            </label>
            <div className="md:col-span-2 flex items-end">
              <button type="button" onClick={saveEvent} disabled={saving || !eventMonth} className="btn-primary w-full">
                {saving ? <Loader2 size={15} className="animate-spin" /> : <CalendarDays size={15} />} Save FCX Details
              </button>
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between text-xs font-semibold text-stone">
              <span>{occupied} of 30 paid spaces</span><span>{percent}%</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-gradient-to-r from-brass via-gold to-moss" style={{ width: `${Math.min(percent, 100)}%` }} />
            </div>
          </div>

          {!experience ? (
            <p className="rounded-lg border border-brass/30 bg-brass/10 p-3 text-sm text-stone">Save the FCX details once to begin adding paid attendees.</p>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-lg border border-border bg-surface-2 p-3 space-y-3">
                <div className="flex items-center gap-2"><Users size={16} className="text-peri" /><p className="text-sm font-semibold text-ink">Registered app member</p></div>
                <AppSelect value={selectedUserId} onChange={setSelectedUserId} options={memberOptions} />
                <AppSelect
                  value={paymentSource}
                  onChange={(value) => setPaymentSource(value as 'app' | 'external')}
                  options={[
                    { value: 'app', label: 'Paid in the app' },
                    { value: 'external', label: 'Paid externally' },
                  ]}
                />
                <button type="button" onClick={addMember} disabled={saving || !selectedUserId} className="btn-secondary w-full">
                  <UserPlus size={15} /> Add Paid Member
                </button>
              </div>

              <div className="rounded-lg border border-border bg-surface-2 p-3 space-y-3">
                <div className="flex items-center gap-2"><UserPlus size={16} className="text-brass" /><p className="text-sm font-semibold text-ink">Unregistered cadet or guest</p></div>
                <input className="input-field" value={guestName} onChange={(event) => setGuestName(event.target.value)} placeholder="Full name" />
                <div className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-brass/40 bg-navy text-gold">
                    {guestPhotoPreview
                      ? <img src={guestPhotoPreview} alt="External participant preview" className="h-full w-full object-cover" />
                      : <ImageIcon size={19} />}
                  </div>
                  <button type="button" onClick={() => chooseGuestPhoto({ kind: 'new' })} disabled={saving} className="btn-secondary min-w-0 flex-1 justify-center text-xs">
                    <Camera size={14} /> {guestPhoto ? 'Change participant photo' : 'Add participant photo'}
                  </button>
                  {guestPhoto && (
                    <button type="button" onClick={() => setGuestPhoto(null)} disabled={saving} className="icon-button h-9 w-9 shrink-0 text-coral" title="Remove participant photo" aria-label="Remove participant photo">
                      <X size={16} />
                    </button>
                  )}
                </div>
                <p className="text-xs text-stone">Use this for someone who paid externally but does not have an app account.</p>
                <button type="button" onClick={addGuest} disabled={saving || !guestName.trim()} className="btn-secondary w-full">
                  <UserPlus size={15} /> Add External Attendee
                </button>
              </div>
            </div>
          )}

          {experience && experience.registrations.length > 0 && (
            <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface-2">
              {experience.registrations.map((registration) => (
                <div key={registration.id} className="flex items-center gap-3 px-3 py-2.5">
                  {registration.is_app_member ? (
                    <span className="relative flex h-8 w-8 flex-shrink-0 items-center justify-center text-xs font-bold text-gold">
                      <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full border border-brass/35 bg-navy">
                        {registration.avatar_url
                          ? <img src={registration.avatar_url} alt="" className="h-full w-full object-cover" />
                          : registration.display_name.charAt(0).toUpperCase()}
                      </span>
                      <VallumAvatarBadge userId={registration.user_id} size="sm" />
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => chooseGuestPhoto({ kind: 'existing', guestName: registration.display_name })}
                      disabled={saving}
                      className="relative flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-full border border-brass/35 bg-navy text-xs font-bold text-gold"
                      title="Add or adjust participant photo"
                      aria-label={`Add or adjust ${registration.display_name}'s photo`}
                    >
                      {registration.avatar_url
                        ? <img src={registration.avatar_url} alt="" className="h-full w-full object-cover" />
                        : registration.display_name.charAt(0).toUpperCase()}
                      <span className="absolute bottom-0 right-0 flex h-4 w-4 items-center justify-center rounded-full bg-peri text-white shadow-sm">
                        <Camera size={9} />
                      </span>
                    </button>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">{registration.display_name}</p>
                    <p className="text-[10px] text-stone">{registration.is_app_member ? 'App member' : 'External attendee'} · paid {registration.payment_source === 'app' ? 'in app' : 'externally'}</p>
                  </div>
                  <button type="button" onClick={() => removeRegistration(registration.id, registration.display_name)} className="btn-ghost h-8 w-8 p-0 text-coral" title="Remove from FCX">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      <input
        ref={guestPhotoInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        className="hidden"
        onChange={(event) => {
          const selected = event.target.files?.[0];
          event.target.value = '';
          if (!selected) return;
          if (selected.size > 12 * 1024 * 1024) {
            alert('Choose a participant photo smaller than 12 MB.');
            return;
          }
          setGuestCropFile(selected);
        }}
      />
      {guestCropFile && (
        <AvatarCropDialog
          file={guestCropFile}
          saving={saving}
          title="Crop participant photo"
          onCancel={() => {
            setGuestCropFile(null);
            setGuestPhotoTarget(null);
          }}
          onConfirm={saveGuestCrop}
        />
      )}
    </div>
  );
}
