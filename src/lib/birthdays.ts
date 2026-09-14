import { supabase } from './supabase';
import type { DailyQuoteComment, PanelImageSetting, PublicBirthdayAnnouncement } from './types';
import type { QuoteReactionState } from '../components/QuoteReactions';
import { panelImageFromAnnouncement } from './panelImages';

export type BirthdayConversation = { reactions: QuoteReactionState; comments: DailyQuoteComment[] };

export async function fetchBirthdayConversation(id: string, date: string) {
  const { data, error } = await supabase.rpc('get_birthday_conversation', { p_celebration_id: id, p_date: date });
  if (error) throw error;
  return data as BirthdayConversation;
}
export async function setBirthdayReaction(id: string, date: string, reaction: string, reacted: boolean) {
  const { error } = await supabase.rpc('set_birthday_reaction', { p_celebration_id: id, p_date: date, p_reaction_type: reaction, p_reacted: reacted });
  if (error) throw error;
}
export async function saveBirthdayWish(id: string, date: string, body: string, wishId?: string, parentId?: string) {
  const { error } = await supabase.rpc('save_birthday_wish', { p_celebration_id: id, p_date: date, p_body: body, p_id: wishId || null, p_parent_id: parentId || null });
  if (error) throw error;
}

export type PublicBirthdayView = PublicBirthdayAnnouncement & { panel_image: PanelImageSetting | null };

export async function fetchPublicBirthdayAnnouncement(id: string, date: string): Promise<PublicBirthdayView | null> {
  const { data, error } = await supabase.rpc('get_public_birthday_announcement', {
    p_celebration_id: id,
    p_date: date,
  });
  if (error) throw error;
  if (!data || typeof data !== 'object') return null;
  const row = data as PublicBirthdayAnnouncement;
  const artwork = row.artwork?.content
    ? panelImageFromAnnouncement({
      content: row.artwork.content,
      image_position_x: row.artwork.image_position_x ?? undefined,
      image_position_y: row.artwork.image_position_y ?? undefined,
    })
    : null;
  return { ...row, panel_image: artwork };
}
