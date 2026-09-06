import { useEffect, useState } from 'react';
import {
  Award, BadgeCheck, BookOpen, Crown, MessageCircle, PenTool, Send,
  Shield, Sprout, Trophy, Users,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { cn } from '../lib/utils';
import { ChiRhoMark } from './ChiRhoMark';

type BadgeSize = 'xs' | 'sm' | 'md';
type AvatarAward = { award_type: string; title: string; cadence: 'weekly' | 'monthly' };

let holderAwards = new Map<string, AvatarAward>();
let loadedAt = 0;
let loadPromise: Promise<void> | null = null;
let realtimeStarted = false;
const listeners = new Set<() => void>();
const CACHE_MS = 60_000;

const AWARD_ICONS = {
  rhetoric: MessageCircle,
  nuncio: BookOpen,
  angel: Send,
  rumor: Crown,
  scribe: PenTool,
  sprout: Sprout,
  reputation: Shield,
  tutorix: BadgeCheck,
  valley_champion: Shield,
  lords_secret: Users,
  monthly_scribe: PenTool,
  monthly_valley_champion: Shield,
  muralis: Award,
  centurion: Shield,
  grand_scribe: PenTool,
  grand_valley_champion: Shield,
  grand_orator: MessageCircle,
  bethel_stone: Trophy,
  temple_mount: Trophy,
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

function publish() {
  listeners.forEach((listener) => listener());
}

async function loadCurrentAwards(force = false) {
  if (!force && loadedAt && Date.now() - loadedAt < CACHE_MS) return;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const { data, error } = await supabase.rpc('get_current_avatar_awards');
    if (error) throw error;
    holderAwards = new Map((data || []).map((award: any) => [award.user_id, {
      award_type: normalizedAwardType(String(award.award_type || ''), String(award.title || '')),
      title: String(award.title || 'Full Circle award'),
      cadence: award.cadence === 'monthly' ? 'monthly' : 'weekly',
    }]));
    loadedAt = Date.now();
    publish();
  })().catch((error) => {
    console.warn('Current avatar awards could not be loaded:', error);
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
  if (realtimeStarted) return;
  realtimeStarted = true;
  supabase
    .channel('award-avatar-badges')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'awards' }, () => {
      void refreshVallumAvatarBadges();
    })
    .subscribe();
}

export function AwardBadgeGlyph({ awardType, title, size = 10 }: { awardType: string; title?: string; size?: number }) {
  const type = normalizedAwardType(awardType, title);
  if (type === 'vallum' || type === 'grand_vallum') return <ChiRhoMark size={size} className="text-current" />;
  const Icon = AWARD_ICONS[type as keyof typeof AWARD_ICONS] || Trophy;
  return <Icon size={size} strokeWidth={2.3} />;
}

export function VallumAvatarBadge({ userId, size = 'sm', className }: {
  userId?: string | null;
  size?: BadgeSize;
  className?: string;
}) {
  const [, render] = useState(0);

  useEffect(() => {
    const listener = () => render((value) => value + 1);
    listeners.add(listener);
    ensureRealtimeUpdates();
    void loadCurrentAwards();
    return () => { listeners.delete(listener); };
  }, []);

  const award = userId ? holderAwards.get(userId) : null;
  if (!award) return null;

  const shellClass = size === 'xs' ? 'h-3.5 w-3.5 border' : size === 'md' ? 'h-5 w-5 border-2' : 'h-4 w-4 border';
  const markSize = size === 'xs' ? 8 : size === 'md' ? 12 : 10;

  return (
    <span
      className={cn(
        'pointer-events-none absolute -bottom-1 -right-1 z-20 inline-flex items-center justify-center rounded-full shadow-md',
        award.cadence === 'monthly' ? 'border-gold/90 bg-navy-2 text-gold' : 'border-peri/80 bg-navy-2 text-peri-bright',
        shellClass,
        className,
      )}
      title={award.title}
      aria-label={award.title}
    >
      <AwardBadgeGlyph awardType={award.award_type} title={award.title} size={markSize} />
    </span>
  );
}
