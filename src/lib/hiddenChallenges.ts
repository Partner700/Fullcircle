import { supabase } from './supabase';
import type {
  CreateHiddenChallengeInput,
  HiddenChallengeParticipant,
  HiddenChallengePlacement,
  HiddenChallengeRelic,
  HiddenChallengeRelicResult,
  HiddenChallengeResult,
  HiddenItemInventory,
  HiddenItemType,
  OpenHiddenChallenge,
} from './types';

export const HIDDEN_CHALLENGE_EVENT = 'full-circle:hidden-challenge';

export type HiddenChallengeEventDetail = {
  claimId?: string;
  claimIds?: string[];
  placement?: HiddenChallengePlacement;
  referenceKey?: string | null;
};

export type HiddenVerseChallengeMarker = {
  claim_id: string;
  reference_key: string;
  item_type: HiddenItemType;
};

const pageNonce = typeof crypto !== 'undefined' && 'randomUUID' in crypto
  ? crypto.randomUUID()
  : `${Date.now()}-${Math.random()}`;

export function hiddenChallengeOpenNonce() {
  return pageNonce;
}

export function revealHiddenChallenge(detail: HiddenChallengeEventDetail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<HiddenChallengeEventDetail>(HIDDEN_CHALLENGE_EVENT, { detail }));
}

export function readingVerseChallengeKey(narrativeId: string, verseReference: string) {
  return `${narrativeId}|${verseReference.trim().toLowerCase()}`;
}

export async function purchaseHiddenItem(itemType: HiddenItemType) {
  const { data, error } = await supabase.rpc('purchase_hidden_item_token', {
    p_item_type: itemType,
  });
  if (error) throw error;
  return data as { token_id: string; item_type: HiddenItemType; cost: number; wallet_denarii: number };
}

export async function fetchHiddenItemInventory() {
  const { data, error } = await supabase.rpc('get_my_hidden_item_inventory');
  if (error) throw error;
  return data as HiddenItemInventory;
}

export async function createHiddenChallenge(input: CreateHiddenChallengeInput) {
  const { data, error } = await supabase.rpc('create_hidden_challenge', {
    p_item_type: input.itemType,
    p_target_ids: input.targetIds,
    p_difficulty: input.difficulty,
    p_placement: input.placement,
    p_reference_key: input.referenceKey || null,
    p_message_body: input.messageBody || null,
    p_reward_denarii: input.rewardDenarii || 0,
    p_reward_relic_type_id: input.rewardRelicTypeId || null,
    p_reward_relic_quantity: input.rewardRelicQuantity || 0,
    p_reward_freezer_type: input.rewardFreezerType || null,
    p_reward_freezer_quantity: input.rewardFreezerQuantity || 0,
    p_mine_penalty_denarii: input.minePenaltyDenarii || 0,
  });
  if (error) throw error;
  return data as { challenge_id: string; item_type: HiddenItemType; recipient_count: number; escrow_denarii: number };
}

export async function findHiddenChallengeClaim(
  placement: HiddenChallengePlacement,
  referenceKey?: string | null,
) {
  const { data, error } = await supabase.rpc('get_pending_hidden_challenge_claim', {
    p_placement: placement,
    p_reference_key: referenceKey || null,
  });
  if (error) throw error;
  return (data || null) as string | null;
}

export async function fetchPendingHiddenVerseMarkers(narrativeIds: string[]) {
  const { data, error } = await supabase.rpc('get_my_pending_hidden_verse_markers', {
    p_narrative_ids: narrativeIds,
  });
  if (error) throw error;
  return (data || []) as HiddenVerseChallengeMarker[];
}

export async function openHiddenChallenge(claimId: string) {
  const { data, error } = await supabase.rpc('open_hidden_challenge', {
    p_claim_id: claimId,
    p_open_nonce: pageNonce,
  });
  if (error) throw error;
  return (data || null) as OpenHiddenChallenge | null;
}

export async function submitHiddenChallengeAnswer(claimId: string, answer: string) {
  const { data, error } = await supabase.rpc('submit_hidden_challenge_answer', {
    p_claim_id: claimId,
    p_open_nonce: pageNonce,
    p_answer: answer,
  });
  if (error) throw error;
  return data as HiddenChallengeResult;
}

export async function forfeitHiddenChallenge(claimId: string) {
  const { data, error } = await supabase.rpc('forfeit_hidden_challenge', {
    p_claim_id: claimId,
    p_open_nonce: pageNonce,
  });
  if (error) throw error;
  return (data || null) as HiddenChallengeResult | null;
}

export async function fetchHiddenChallengeResult(claimId: string) {
  const { data, error } = await supabase.rpc('get_hidden_challenge_result', {
    p_claim_id: claimId,
  });
  if (error) throw error;
  return (data || null) as HiddenChallengeResult | null;
}

export async function fetchHiddenChallengeParticipants(challengeId: string) {
  const { data, error } = await supabase.rpc('get_hidden_challenge_participants', {
    p_challenge_id: challengeId,
  });
  if (error) throw error;
  return (data || []) as HiddenChallengeParticipant[];
}

export async function fetchHiddenChallengeRelics(claimId: string) {
  const { data, error } = await supabase.rpc('get_my_hidden_challenge_relics', {
    p_claim_id: claimId,
  });
  if (error) throw error;
  return (data || []) as HiddenChallengeRelic[];
}

export async function deployHiddenChallengeRelic(
  claimId: string,
  relicSlug: string,
  answer?: string | null,
) {
  const { data, error } = await supabase.rpc('use_hidden_challenge_relic', {
    p_claim_id: claimId,
    p_open_nonce: pageNonce,
    p_relic_slug: relicSlug,
    p_answer: answer?.trim() || null,
  });
  if (error) throw error;
  return data as HiddenChallengeRelicResult;
}
