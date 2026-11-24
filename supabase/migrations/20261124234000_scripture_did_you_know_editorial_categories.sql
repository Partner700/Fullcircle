-- Categories identify *why* a fact is interesting, without confusing theological
-- interpretation, textual history or historical confirmation.
alter table public.scripture_did_you_know
  add column if not exists category text not null default 'scripture_detail';
alter table public.scripture_did_you_know
  add constraint scripture_did_you_know_category_valid
  check (category in (
    'plain_language','ancient_culture','scholarly_agreement','scholarly_debate',
    'earliest_evidence','original_language','scripture_detail','textual_connection'
  ));
