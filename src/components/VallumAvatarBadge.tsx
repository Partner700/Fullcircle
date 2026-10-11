import { useSyncExternalStore } from 'react';
import {
  Award, BadgeCheck, BookOpen, Crown, Gem, KeyRound, Landmark, Medal,
  MessageCircle, PenTool, Send, Shield, Sprout, Star,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { cn } from '../lib/utils';
import { ChiRhoMark } from './ChiRhoMark';

export type AvatarBadgeSize = 'auto' | 'xs' | 'sm' | 'md';
type AvatarAward = { award_type: string; title: string; cadence: 'weekly' | 'monthly' };

let holderAwards = new Map<string, AvatarAward>();
let loadedAt = 0;
let loadPromise: Promise<void> | null = null;
let realtimeStarted = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let cacheHydrated = false;
let lastVerifiedAt = 0;
const listeners = new Set<() => void>();
const CACHE_MS = 60_000;
const RETRY_MS = 5_000;
const STORAGE_KEY = 'full-circle-standing-avatar-awards';
const LEGACY_STORAGE_KEYS = [
  'full-circle-standing-avatar-awards-target-v2',
  'full-circle-standing-avatar-awards-target-v1',
] as const;
const EMPTY_AWARDS = new Map<string, AvatarAward>();

type CachedAvatarAward = AvatarAward & { user_id: string };
type CurrentAvatarAwardRow = {
  user_id?: string | null;
  award_type?: string | null;
  title?: string | null;
  cadence?: string | null;
};
type DirectAvatarAwardRow = CurrentAvatarAwardRow & {
  award_month?: string | null;
  created_at?: string | null;
  award_target_type?: string | null;
  award_target_id?: string | null;
};
type CachedAwardEnvelope = {
  version: 3;
  verified_at: string;
  awards: CachedAvatarAward[];
};

const AWARD_ICONS = {
  rhetoric: MessageCircle,
  nuncio: BookOpen,
  angel: Send,
  rumor: Crown,
  scribe: PenTool,
  sprout: Sprout,
  reputation: Star,
  tutorix: BadgeCheck,
  valley_champion: Shield,
  lords_secret: KeyRound,
  monthly_scribe: PenTool,
  monthly_valley_champion: Shield,
  muralis: Medal,
  centurion: Shield,
  grand_scribe: PenTool,
  grand_valley_champion: Shield,
  grand_orator: MessageCircle,
  bethel_stone: Gem,
  temple_mount: Landmark,
} as const;

function normalizedAwardType(awardType: string, title = '') {
  const type = awardType.trim().toLowerCase().replace(/[\s-]+/g, '_');
  const normalizedTitle = title.trim().toLowerCase();
  if (type && type !== 'individual' && type !== 'cadet' && type !== 'sentry') return type;
  if (normalizedTitle.includes('grand vallum')) return 'grand_vallum';
  if (normalizedTitle.includes('vallum')) return 'vallum';
  if (normalizedTitle.includes('muralis')) return 'muralis';
  if (normalizedTitle.includes('centurion')) return 'centurion';
  if (normalizedTitle.includes('angel')) return 'angel';
  if (normalizedTitle.includes('nuncio')) return 'nuncio';
  if (normalizedTitle.includes('rhetoric')) return 'rhetoric';
  if (normalizedTitle.includes('scribe')) return normalizedTitle.includes('monthly') ? 'monthly_scribe' : 'scribe';
  return type || 'award';
}

function awardPriority(award: AvatarAward) {
  const type = normalizedAwardType(award.award_type, award.title);
  return type === 'vallum' ? 2 : type === 'centurion' ? 1 : 0;
}

function addStandingAward(target: Map<string, AvatarAward>, userId: string, award: AvatarAward) {
  if (!userId) return;
  const current = target.get(userId);
  if (!current || awardPriority(award) > awardPriority(current)) target.set(userId, award);
}

function hasStandingType(target: Map<string, AvatarAward>, standingType: 'vallum' | 'centurion') {
  return [...target.values()].some((award) => normalizedAwardType(award.award_type, award.title) === standingType);
}

async function loadStandingAwardsDirectly() {
  const { data, error } = await supabase
    .from('awards')
    .select('user_id, award_type, title, award_month, created_at, award_target_type, award_target_id')
    .or('award_type.ilike.%vallum%,title.ilike.%vallum%,award_type.ilike.%centurion%,title.ilike.%centurion%')
    .order('created_at', { ascending: false })
    .limit(24);
  if (error) throw error;

  const latest = new Map<'vallum' | 'centurion', DirectAvatarAwardRow>();
  ((data || []) as DirectAvatarAwardRow[]).forEach((award) => {
    const type = normalizedAwardType(String(award.award_type || ''), String(award.title || ''));
    if (type !== 'vallum' && type !== 'centurion') return;
    const cycle = String(award.award_month || '');
    if (!/^\d{4}-\d{2}$/.test(cycle) || award.award_target_type === 'tent') return;
    const current = latest.get(type);
    const createdAt = String(award.created_at || '');
    if (!current
      || cycle > String(current.award_month || '')
      || (cycle === String(current.award_month || '') && createdAt > String(current.created_at || ''))) {
      latest.set(type, award);
    }
  });

  const result = new Map<string, AvatarAward>();
  latest.forEach((award, type) => {
    const recipientId = String(award.user_id || award.award_target_id || '');
    addStandingAward(result, recipientId, {
      award_type: type,
      title: String(award.title || (type === 'vallum' ? 'Vallum' : 'Centurion')),
      cadence: 'monthly',
    });
  });
  return result;
}

function mergeVerifiedStandingAwards(incoming: Map<string, AvatarAward>) {
  const merged = new Map(holderAwards);
  (['vallum', 'centurion'] as const).forEach((standingType) => {
    const replacements = [...incoming.entries()].filter(([, award]) => (
      normalizedAwardType(award.award_type, award.title) === standingType
    ));
    if (replacements.length === 0) return;
    [...merged.entries()].forEach(([userId, award]) => {
      if (normalizedAwardType(award.award_type, award.title) === standingType) merged.delete(userId);
    });
    replacements.forEach(([userId, award]) => addStandingAward(merged, userId, award));
  });
  return merged;
}

function publish() {
  listeners.forEach((listener) => listener());
}

function cachedAwardList(value: unknown): { awards: CachedAvatarAward[]; verifiedAt: number } | null {
  const envelope = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<CachedAwardEnvelope>
    : null;
  const awards = Array.isArray(value)
    ? value
    : envelope && Array.isArray(envelope.awards) ? envelope.awards : null;
  if (!awards?.length) return null;
  const verifiedAt = envelope?.verified_at ? Date.parse(envelope.verified_at) : 1;
  return {
    awards: awards as CachedAvatarAward[],
    verifiedAt: Number.isFinite(verifiedAt) ? verifiedAt : 1,
  };
}

function availableBrowserStorage() {
  if (typeof window === 'undefined') return [] as Storage[];
  const storage: Storage[] = [];
  try { storage.push(window.localStorage); } catch { /* Private browsing can deny access. */ }
  try { storage.push(window.sessionStorage); } catch { /* Keep the in-memory result. */ }
  return storage;
}

function hydrateCachedAwards(force = false) {
  if ((!force && cacheHydrated) || typeof window === 'undefined') return;
  cacheHydrated = true;

  let best: { awards: CachedAvatarAward[]; verifiedAt: number } | null = null;
  const keys = [STORAGE_KEY, ...LEGACY_STORAGE_KEYS];
  availableBrowserStorage().forEach((storage) => {
    keys.forEach((key) => {
      try {
        const raw = storage.getItem(key);
        if (!raw) return;
        const candidate = cachedAwardList(JSON.parse(raw));
        if (candidate && (!best || candidate.verifiedAt > best.verifiedAt)) best = candidate;
      } catch {
        // One damaged cache entry must not hide a valid copy or block live loading.
      }
    });
  });

  const cached = best as { awards: CachedAvatarAward[]; verifiedAt: number } | null;
  if (!cached || cached.verifiedAt < lastVerifiedAt) return;
  const cachedAwards = new Map<string, AvatarAward>();
  cached.awards.forEach((award) => addStandingAward(cachedAwards, award.user_id, {
    award_type: normalizedAwardType(award.award_type, award.title),
    title: award.title,
    cadence: award.cadence === 'monthly' ? 'monthly' : 'weekly',
  }));
  if (cachedAwards.size > 0) {
    holderAwards = cachedAwards;
    lastVerifiedAt = cached.verifiedAt;
    publish();
  }
}

function persistCurrentAwards() {
  if (typeof window === 'undefined') return;
  const awards = [...holderAwards.entries()].map(([user_id, award]) => ({ user_id, ...award }));
  const envelope: CachedAwardEnvelope = {
    version: 3,
    verified_at: new Date(lastVerifiedAt || Date.now()).toISOString(),
    awards,
  };
  availableBrowserStorage().forEach((storage) => {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(envelope));
      // Keep the immediately previous app shell compatible during service-worker replacement.
      storage.setItem(LEGACY_STORAGE_KEYS[0], JSON.stringify(awards));
    } catch {
      // The verified in-memory result remains visible when storage is unavailable.
    }
  });
}

async function loadCurrentAwards(force = false) {
  hydrateCachedAwards();
  if (!force && loadedAt && Date.now() - loadedAt < CACHE_MS) return;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const nextAwards = new Map<string, AvatarAward>();
    let rpcError: unknown = null;
    try {
      const { data, error } = await supabase.rpc('get_current_avatar_awards');
      if (error) throw error;
      ((data || []) as CurrentAvatarAwardRow[]).forEach((award) => addStandingAward(nextAwards, String(award.user_id || ''), {
        award_type: normalizedAwardType(String(award.award_type || ''), String(award.title || '')),
        title: String(award.title || 'Full Circle award'),
        cadence: award.cadence === 'monthly' ? 'monthly' : 'weekly',
      }));
    } catch (error) {
      rpcError = error;
    }

    if (!hasStandingType(nextAwards, 'vallum') || !hasStandingType(nextAwards, 'centurion')) {
      try {
        const directAwards = await loadStandingAwardsDirectly();
        directAwards.forEach((award, userId) => addStandingAward(nextAwards, userId, award));
      } catch (directError) {
        if (nextAwards.size === 0) throw rpcError || directError;
      }
    }
    if (nextAwards.size === 0 && holderAwards.size > 0) {
      throw new Error('Standing award refresh returned no holders. Keeping the last verified result.');
    }
    holderAwards = mergeVerifiedStandingAwards(nextAwards);
    lastVerifiedAt = Date.now();
    persistCurrentAwards();
    loadedAt = lastVerifiedAt;
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    publish();
  })().catch((error) => {
    console.warn('Current avatar awards could not be loaded:', error);
    if (!retryTimer && listeners.size > 0) {
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void loadCurrentAwards(true);
      }, RETRY_MS);
    }
  }).finally(() => {
    loadPromise = null;
  });
  return loadPromise;
}

export function refreshVallumAvatarBadges() {
  loadedAt = 0;
  return loadCurrentAwards(true);
}

function ensureRealtimeUpdates() {
  if (realtimeStarted || typeof window === 'undefined') return;
  realtimeStarted = true;
  supabase
    .channel('award-avatar-badges')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'awards' }, () => {
      void refreshVallumAvatarBadges();
    })
    .subscribe();
  window.addEventListener('online', () => void refreshVallumAvatarBadges());
  window.addEventListener('focus', () => void loadCurrentAwards());
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY || LEGACY_STORAGE_KEYS.includes(event.key as typeof LEGACY_STORAGE_KEYS[number])) {
      hydrateCachedAwards(true);
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void loadCurrentAwards();
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  ensureRealtimeUpdates();
  void loadCurrentAwards();
  return () => { listeners.delete(listener); };
}

function getAwardSnapshot() {
  return holderAwards;
}

function getServerAwardSnapshot() {
  return EMPTY_AWARDS;
}

// Restore the last verified holders before the first avatar is rendered.
hydrateCachedAwards();

export function AwardBadgeGlyph({ awardType, title, size = 10 }: { awardType: string; title?: string; size?: number }) {
  const type = normalizedAwardType(awardType, title);
  if (type === 'vallum' || type === 'grand_vallum') return <ChiRhoMark size={size} className="text-current" />;
  const Icon = AWARD_ICONS[type as keyof typeof AWARD_ICONS] || Award;
  return <Icon size={size} strokeWidth={2.3} />;
}

export function VallumAvatarBadge({ userId, size = 'sm', className }: {
  userId?: string | null;
  size?: AvatarBadgeSize;
  className?: string;
}) {
  const awards = useSyncExternalStore(subscribe, getAwardSnapshot, getServerAwardSnapshot);
  const award = userId ? awards.get(userId) : null;
  if (!award) return null;
  const awardType = normalizedAwardType(award.award_type, award.title);
  if (awardType !== 'vallum' && awardType !== 'centurion') return null;
  const isVallum = awardType === 'vallum';

  const shellClass = size === 'auto'
    ? 'h-[42%] w-[42%] min-h-4 min-w-4 max-h-6 max-w-6 border-2'
    : size === 'xs' ? 'h-3.5 w-3.5 border' : size === 'md' ? 'h-5 w-5 border-2' : 'h-4 w-4 border';
  const markSize = size === 'auto' ? 12 : size === 'xs' ? 10 : size === 'md' ? 13 : 11;

  return (
    <span
      className={cn(
        'full-circle-avatar-award-badge pointer-events-none absolute left-0 top-0 z-20 inline-flex items-center justify-center rounded-full shadow-md',
        isVallum
          ? 'border-navy/40 bg-gold text-navy'
          : 'border-sage/80 bg-navy-2 text-sage-bright',
        shellClass,
        className,
      )}
      title={award.title}
      aria-label={award.title}
    >
      <AwardBadgeGlyph awardType={awardType} title={award.title} size={markSize} />
    </span>
  );
}
