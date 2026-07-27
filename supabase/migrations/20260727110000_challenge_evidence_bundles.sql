ALTER TABLE public.challenge_submissions
  ADD COLUMN IF NOT EXISTS evidence_items jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.challenge_submissions
  DROP CONSTRAINT IF EXISTS challenge_submissions_evidence_items_array_check;

ALTER TABLE public.challenge_submissions
  ADD CONSTRAINT challenge_submissions_evidence_items_array_check
  CHECK (jsonb_typeof(evidence_items) = 'array');

UPDATE public.challenge_submissions
SET evidence_items = jsonb_build_array(
  CASE
    WHEN proof_type = 'link' THEN jsonb_build_object(
      'id', gen_random_uuid()::text,
      'kind', 'link',
      'url', proof_text
    )
    ELSE jsonb_build_object(
      'id', gen_random_uuid()::text,
      'kind', 'text',
      'content', proof_text
    )
  END
)
WHERE proof_text IS NOT NULL
  AND btrim(proof_text) <> ''
  AND evidence_items = '[]'::jsonb;

INSERT INTO storage.buckets (id, name, public)
VALUES ('challenge-evidence', 'challenge-evidence', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS "challenge_evidence_read" ON storage.objects;
CREATE POLICY "challenge_evidence_read"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'challenge-evidence'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.is_instructor(auth.uid())
      OR EXISTS (
        SELECT 1
        FROM public.challenge_submissions submission
        WHERE submission.user_id = auth.uid()
          AND EXISTS (
            SELECT 1
            FROM jsonb_array_elements(submission.evidence_items) item
            WHERE item->>'storage_path' = name
          )
      )
    )
  );

DROP POLICY IF EXISTS "challenge_evidence_upload" ON storage.objects;
CREATE POLICY "challenge_evidence_upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'challenge-evidence'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "challenge_evidence_update" ON storage.objects;
CREATE POLICY "challenge_evidence_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'challenge-evidence'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'challenge-evidence'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "challenge_evidence_delete" ON storage.objects;
CREATE POLICY "challenge_evidence_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'challenge-evidence'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
