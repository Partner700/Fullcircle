import { supabase } from './supabase';

export type AwardReleaseItem = {
  title: string;
  description: string | null;
  target_type: 'cadet' | 'sentry' | 'tent';
  target_id: string;
  award_month: string;
  recipient_name: string;
};

export type AwardRelease = {
  id: string;
  items: AwardReleaseItem[];
  scheduled_at: string;
  status: 'scheduled' | 'published' | 'cancelled' | 'failed';
  published_at: string | null;
  last_error: string | null;
};

export function awardReleaseItemKey(item: AwardReleaseItem) {
  return [item.title, item.target_type, item.target_id, item.award_month].join(':');
}

export async function fetchAwardReleases(): Promise<AwardRelease[]> {
  const { data, error } = await supabase.from('award_releases')
    .select('id,items,scheduled_at,status,published_at,last_error')
    .order('created_at', { ascending: false }).limit(50);
  if (error) throw error;
  return data || [];
}

export async function scheduleAwardRelease(id: string, items: AwardReleaseItem[], releaseAt: string | null) {
  const { error } = await supabase.rpc('schedule_award_release', {
    p_id: id, p_items: items, p_release_at: releaseAt,
  });
  if (error) throw error;
}

export async function changeAwardRelease(id: string, releaseAt: string | null) {
  const { error } = await supabase.rpc('change_award_release', { p_id: id, p_release_at: releaseAt });
  if (error) throw error;
}
