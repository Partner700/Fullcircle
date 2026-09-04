import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { cn } from '../lib/utils';
import { ChiRhoMark } from './ChiRhoMark';

type BadgeSize = 'xs' | 'sm' | 'md';

let holderIds = new Set<string>();
let loadedAt = 0;
let loadPromise: Promise<void> | null = null;
let realtimeStarted = false;
const listeners = new Set<() => void>();
const CACHE_MS = 60_000;

function publish() {
  listeners.forEach((listener) => listener());
}

async function loadCurrentVallum(force = false) {
  if (!force && loadedAt && Date.now() - loadedAt < CACHE_MS) return;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const { data, error } = await supabase
      .from('awards')
      .select('user_id,award_month,created_at')
      .ilike('title', 'Vallum')
      .not('user_id', 'is', null)
      .order('award_month', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    const latestMonth = data?.[0]?.award_month || null;
    holderIds = new Set(
      (data || [])
        .filter((award) => award.award_month === latestMonth)
        .map((award) => award.user_id)
        .filter((userId): userId is string => Boolean(userId)),
    );
    loadedAt = Date.now();
    publish();
  })().catch((error) => {
    console.warn('Current Vallum holder could not be loaded:', error);
  }).finally(() => {
    loadPromise = null;
  });
  return loadPromise;
}

export function refreshVallumAvatarBadges() {
  loadedAt = 0;
  return loadCurrentVallum(true);
}

function ensureRealtimeUpdates() {
  if (realtimeStarted) return;
  realtimeStarted = true;
  supabase
    .channel('vallum-avatar-badges')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'awards' }, () => {
      void refreshVallumAvatarBadges();
    })
    .subscribe();
}

export function VallumAvatarBadge({
  userId,
  size = 'sm',
  className,
}: {
  userId?: string | null;
  size?: BadgeSize;
  className?: string;
}) {
  const [, render] = useState(0);

  useEffect(() => {
    const listener = () => render((value) => value + 1);
    listeners.add(listener);
    ensureRealtimeUpdates();
    void loadCurrentVallum();
    return () => { listeners.delete(listener); };
  }, []);

  if (!userId || !holderIds.has(userId)) return null;

  const shellClass = size === 'xs'
    ? 'h-3.5 w-3.5 border'
    : size === 'md'
      ? 'h-5 w-5 border-2'
      : 'h-4 w-4 border';
  const markSize = size === 'xs' ? 8 : size === 'md' ? 12 : 10;

  return (
    <span
      className={cn(
        'pointer-events-none absolute -bottom-1 -right-1 z-20 inline-flex items-center justify-center rounded-full border-gold/75 bg-navy-2 text-gold shadow-md',
        shellClass,
        className,
      )}
      title="Vallum"
      aria-label="Current Vallum"
    >
      <ChiRhoMark size={markSize} className="text-current" />
    </span>
  );
}
