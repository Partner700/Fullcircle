import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { EmptyState } from '../../components/AppShell';
import { ScrollEdge, SealBullet } from '../../components/AncientMotifs';
import { ChallengeEvidenceList } from '../../components/ChallengeEvidenceList';
import { fetchNarrative, fetchChallengeSubmission, fetchPanelImageSetting, upsertChallengeSubmission } from '../../lib/queries';
import { panelImageObjectPosition } from '../../lib/panelImages';
import { supabase } from '../../lib/supabase';
import { getDayType, getTodayISODate, cn } from '../../lib/utils';
import { MEDITATION_CUTOFF_HOUR, MEDITATION_CUTOFF_MINUTE } from '../../lib/constants';
import type { DailyNarrative, ChallengeSubmission, ChallengeProofFormat, PanelImageSetting, ChallengeEvidenceItem } from '../../lib/types';
import {
  BookOpen, BookMarked, Lightbulb, Target, CheckCircle2, Save, Sparkles,
  Quote, ScrollText, Sun, Link2, Image as ImageIcon,
  AlertCircle, RefreshCw, FileText, Upload, Trash2, Plus, Paperclip,
} from 'lucide-react';

type PendingChallengeFile = {
  id: string;
  file: File;
};

function persistentEvidence(item: ChallengeEvidenceItem): ChallengeEvidenceItem {
  const { preview_url: _previewUrl, ...stored } = item;
  return stored;
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function CadetNarrative({
  onMeditationSaved,
  streakCount = 0,
}: {
  onMeditationSaved?: () => Promise<void> | void;
  streakCount?: number;
}) {
  const { profile } = useAuth();
  const [narrative, setNarrative] = useState<DailyNarrative | null>(null);
  const [loading, setLoading] = useState(true);
  const [meditation, setMeditation] = useState('');
  const [bestVerse, setBestVerse] = useState('');
  const [dailyQuote, setDailyQuote] = useState('');
  const [savedMeditation, setSavedMeditation] = useState(false);
  const [challenge, setChallenge] = useState<ChallengeSubmission | null>(null);
  const [challengeText, setChallengeText] = useState('');
  const [challengeLinks, setChallengeLinks] = useState<string[]>(['']);
  const [challengeFiles, setChallengeFiles] = useState<ChallengeEvidenceItem[]>([]);
  const [pendingChallengeFiles, setPendingChallengeFiles] = useState<PendingChallengeFile[]>([]);
  const [challengeSaved, setChallengeSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [readingImage, setReadingImage] = useState<PanelImageSetting | null>(null);

  const today = getTodayISODate();
  const dayType = getDayType(new Date());
  const isSundayRest = dayType === 'sunday';

  const load = useCallback(async () => {
    if (!profile) { setLoading(false); return; }
    setLoading(true);
    try {
    const [narr, chal, readingImage] = await Promise.all([
      fetchNarrative(today),
      fetchChallengeSubmission(profile.id, today),
      fetchPanelImageSetting('reading'),
    ]);
    setNarrative(narr);
    setChallenge(chal);
    setReadingImage(readingImage);
    const evidence = Array.isArray(chal?.evidence_items) ? chal.evidence_items : [];
    const textEvidence = evidence.find((item) => item.kind === 'text')?.content;
    const linkEvidence = evidence
      .filter((item) => item.kind === 'link' && item.url)
      .map((item) => item.url as string);
    const fileEvidence = evidence.filter((item) => item.kind === 'image' || item.kind === 'document');
    const legacyIsLink = chal?.proof_type === 'link' && chal.proof_text;
    setChallengeText(textEvidence || (!legacyIsLink ? chal?.proof_text || '' : ''));
    setChallengeLinks(linkEvidence.length > 0 ? linkEvidence : legacyIsLink ? [chal.proof_text as string] : ['']);
    setChallengeFiles(fileEvidence);
    setPendingChallengeFiles([]);
    setChallengeSaved(Boolean(chal && chal.status !== 'rejected'));

    const { data: record } = await supabase
      .from('daily_records')
      .select('meditation_text, meditation_submitted, best_verse, daily_quote')
      .eq('user_id', profile.id)
      .eq('record_date', today)
      .maybeSingle();
    if (record?.meditation_text) {
      setMeditation(record.meditation_text);
      setSavedMeditation(record.meditation_submitted);
    }
    if (record?.best_verse) setBestVerse(record.best_verse);
    if (record?.daily_quote) setDailyQuote(record.daily_quote);
    } catch (e) { console.error('Narrative load error:', e); }
    setLoading(false);
  }, [profile, today]);

  useEffect(() => {
    load();
  }, [load]);

  const meditationWordCount = meditation.trim() ? meditation.trim().split(/\s+/).length : 0;
  const quoteWordCount = dailyQuote.trim() ? dailyQuote.trim().split(/\s+/).length : 0;
  const now = new Date();
  const afterMeditationCutoff =
    now.getHours() > MEDITATION_CUTOFF_HOUR ||
    (now.getHours() === MEDITATION_CUTOFF_HOUR && now.getMinutes() >= MEDITATION_CUTOFF_MINUTE);
  const canSubmitMeditation =
    !afterMeditationCutoff &&
    bestVerse.trim().length > 0 &&
    meditationWordCount >= 50 &&
    quoteWordCount > 0 &&
    quoteWordCount <= 10;

  const saveMeditation = async () => {
    if (!profile || !canSubmitMeditation) return;
    setSaving(true);
    const { error } = await supabase.rpc('record_meditation_streak', {
      p_user_id: profile.id,
      p_date: today,
      p_text: meditation.trim(),
    });
    if (error) {
      alert(error.message || 'Meditation could not be saved.');
      setSaving(false);
      return;
    }
    // Save best_verse and daily_quote alongside meditation
    const { data: existing } = await supabase
      .from('daily_records')
      .select('id')
      .eq('user_id', profile.id)
      .eq('record_date', today)
      .maybeSingle();
    if (existing) {
      await supabase.from('daily_records').update({
        best_verse: bestVerse.trim(),
        daily_quote: dailyQuote.trim(),
      }).eq('id', existing.id);
    }
    setSavedMeditation(true);
    setSaving(false);
    await onMeditationSaved?.();
  };

  const saveChallenge = async () => {
    if (!profile) return;
    const cleanLinks = challengeLinks.map((link) => link.trim()).filter(Boolean);
    const invalidLink = cleanLinks.find((link) => !isHttpUrl(link));
    if (invalidLink) {
      alert(`Please enter a complete link beginning with http:// or https://: ${invalidLink}`);
      return;
    }
    if (!challengeText.trim() && cleanLinks.length === 0 && challengeFiles.length === 0 && pendingChallengeFiles.length === 0) return;

    setSaving(true);
    const uploadedItems: ChallengeEvidenceItem[] = [];
    try {
      for (const pending of pendingChallengeFiles) {
        if (pending.file.size > 10 * 1024 * 1024) {
          throw new Error(`${pending.file.name} is larger than 10 MB.`);
        }
        const safeName = pending.file.name.replace(/[^a-zA-Z0-9._-]+/g, '-');
        const storagePath = `${profile.id}/${today}/${crypto.randomUUID()}-${safeName}`;
        const { error } = await supabase.storage
          .from('challenge-evidence')
          .upload(storagePath, pending.file, { contentType: pending.file.type || undefined });
        if (error) throw error;
        uploadedItems.push({
          id: crypto.randomUUID(),
          kind: pending.file.type.startsWith('image/') ? 'image' : 'document',
          storage_path: storagePath,
          file_name: pending.file.name,
          mime_type: pending.file.type || 'application/octet-stream',
          size_bytes: pending.file.size,
        });
      }

      const evidenceItems: ChallengeEvidenceItem[] = [
        ...(challengeText.trim() ? [{
          id: crypto.randomUUID(),
          kind: 'text' as const,
          content: challengeText.trim(),
        }] : []),
        ...cleanLinks.map((url) => ({
          id: crypto.randomUUID(),
          kind: 'link' as const,
          url,
        })),
        ...challengeFiles.map(persistentEvidence),
        ...uploadedItems,
      ];
      const evidenceKinds = new Set(evidenceItems.map((item) => item.kind));
      const proofType = evidenceKinds.size > 1 ? 'mixed' : evidenceItems[0]?.kind || narrative?.challenge_proof_format || 'text';
      const proofSummary = challengeText.trim()
        || cleanLinks[0]
        || `${evidenceItems.length} evidence item${evidenceItems.length === 1 ? '' : 's'}`;

      await upsertChallengeSubmission({
        ...(challenge?.id ? { id: challenge.id } : {}),
        user_id: profile.id,
        narrative_date: today,
        proof_text: proofSummary,
        proof_type: proofType,
        evidence_items: evidenceItems,
        status: 'pending',
        rejection_reason: null,
        reviewed_at: null,
        reviewed_by: null,
        submitted_at: new Date().toISOString(),
      });

      const retainedPaths = new Set(evidenceItems.map((item) => item.storage_path).filter(Boolean));
      const removedPaths = (challenge?.evidence_items || [])
        .map((item) => item.storage_path)
        .filter((path): path is string => Boolean(path && !retainedPaths.has(path)));
      if (removedPaths.length > 0) {
        await supabase.storage.from('challenge-evidence').remove(removedPaths);
      }

      setChallengeSaved(true);
      await load();
    } catch (error: any) {
      const uploadedPaths = uploadedItems.map((item) => item.storage_path).filter(Boolean) as string[];
      if (uploadedPaths.length > 0) {
        await supabase.storage.from('challenge-evidence').remove(uploadedPaths);
      }
      alert(error?.message || 'Challenge evidence could not be submitted.');
    }
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="text-center py-12 text-stone animate-fade-in">
        Loading today's reading…
      </div>
    );
  }

  if (!narrative) {
    return (
      <EmptyState
        icon={BookOpen}
        title="No reading published"
        message="Today's narrative hasn't been published yet. Check back soon."
      />
    );
  }

  const challengeRejected = challenge?.status === 'rejected';
  const challengeApproved = challenge?.status === 'approved';
  const proofFormat: ChallengeProofFormat = (narrative.challenge_proof_format as ChallengeProofFormat) || 'text';
  const nonEmptyChallengeLinks = challengeLinks.map((link) => link.trim()).filter(Boolean);
  const hasInvalidChallengeLink = nonEmptyChallengeLinks.some((link) => !isHttpUrl(link));
  const challengeHasEvidence =
    Boolean(challengeText.trim())
    || nonEmptyChallengeLinks.length > 0
    || challengeFiles.length > 0
    || pendingChallengeFiles.length > 0;

  return (
    <div className="space-y-5 animate-fade-in max-w-3xl mx-auto">
      {/* ── Header card — scripture reference + theme ── */}
      <div className="card relative overflow-hidden p-4 sm:p-5 animate-slide-up bg-surface-2 border-border">
        {readingImage && (
          <img
            src={readingImage.url}
            alt=""
            className="absolute inset-0 h-full w-full object-cover opacity-[0.18] pointer-events-none"
            style={{ objectPosition: panelImageObjectPosition(readingImage) }}
          />
        )}
        {readingImage && <div className="absolute inset-0 bg-surface-2/75 pointer-events-none" />}
        <div className="relative">
          <div className="eyebrow text-brass flex items-center gap-2 mb-2">
            <BookMarked size={14} strokeWidth={1.5} />
            {narrative.scripture_reference} · {narrative.translation}
          </div>
          <h2 className="font-display text-2xl font-semibold text-ink leading-tight">
            {narrative.title}
          </h2>
          <p className="text-sm text-stone mt-1.5">{narrative.theme}</p>
        </div>
      </div>

      {narrative.verse_of_day && (
        <div className="card p-4 sm:p-5 animate-slide-up bg-surface-2 border-brass/30">
          <div className="flex items-center gap-2 mb-3">
            <Sun size={18} className="text-brass" strokeWidth={1.5} />
            <span className="eyebrow text-stone">Verse of the Day</span>
          </div>
          <ScrollEdge position="top" className="text-brass mb-3" />
          <p className="preserve-paragraphs font-display text-xl text-ink leading-snug font-serif">
            &ldquo;{narrative.verse_of_day}&rdquo;
          </p>
          <ScrollEdge position="bottom" className="text-brass mt-3" />
        </div>
      )}

      {/* ── Scripture text ── */}
      <div className="card p-4 sm:p-5 animate-slide-up bg-surface border-border">
        <div className="flex items-center gap-2 mb-3">
          <ScrollText size={18} className="text-brass" strokeWidth={1.5} />
          <span className="eyebrow text-stone">Scripture</span>
        </div>
        <ScrollEdge position="top" className="text-brass mb-4" />
        <div className="prose prose-sm max-w-none">
          <p className="preserve-paragraphs text-ink leading-relaxed font-serif text-[15px]">
            {narrative.main_text}
          </p>
        </div>
        <ScrollEdge position="bottom" className="text-brass mt-4" />
      </div>

      {/* ── Highlighted verses ── */}
      {narrative.highlighted_verses && narrative.highlighted_verses.length > 0 && (
        <div className="card p-4 sm:p-5 animate-slide-up bg-surface border-border">
          <div className="flex items-center gap-2 mb-4">
            <Quote size={18} className="text-brass" strokeWidth={1.5} />
            <span className="eyebrow text-stone">Highlighted Verses</span>
          </div>
          <div className="space-y-5">
            {narrative.highlighted_verses.map((v, i) => (
              <div
                key={i}
                className="relative pl-5 border-l-2 border-brass/40 bg-surface-2/50 rounded-r-lg py-4 pr-4"
              >
                <ScrollEdge position="top" className="text-brass mb-3" />
                <p className="preserve-paragraphs font-display text-2xl text-ink leading-snug">
                  &ldquo;{v.text}&rdquo;
                </p>
                <p className="text-xs text-brass font-medium mt-2 eyebrow">
                  {v.reference}
                </p>
                <p className="preserve-paragraphs text-sm text-stone mt-3 leading-relaxed">
                  {v.meditation}
                </p>
                <ScrollEdge position="bottom" className="text-brass mt-3" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Reflection prompts ── */}
      {narrative.reflection_prompts && narrative.reflection_prompts.length > 0 && (
        <div className="card p-4 sm:p-5 animate-slide-up bg-surface border-border">
          <div className="flex items-center gap-2 mb-4">
            <Lightbulb size={18} className="text-moss" strokeWidth={1.5} />
            <span className="eyebrow text-stone">Reflection Prompts</span>
          </div>
          <ul className="space-y-2.5">
            {narrative.reflection_prompts.map((prompt, i) => (
              <li key={i} className="flex gap-3 items-start">
                <SealBullet className="text-brass flex-shrink-0 mt-1.5" />
                <p className="preserve-paragraphs text-sm text-ink leading-relaxed">{prompt}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Meditation submission — three sections ── */}
      {!isSundayRest && <div className="card p-4 sm:p-5 animate-slide-up bg-surface border-border">
        <div className="flex items-center justify-between gap-3 mb-1">
          <span className="eyebrow text-stone">Daily Meditation</span>
          <span className="badge badge-moss text-[10px]">
            <FlameIcon size={10} className="mr-1" /> Streak {streakCount}
          </span>
        </div>
        {afterMeditationCutoff && !savedMeditation && (
          <div className="mt-3 mb-3 p-3 rounded-lg bg-roman/10 border border-roman/25 text-xs text-roman">
            Streak submissions close at 9:00 PM. You can read and draft, but today can no longer be registered for the streak.
          </div>
        )}
        <div className="flex items-center gap-2 mt-3 mb-3">
          <ScrollText size={18} className="text-brass" strokeWidth={1.5} />
          <h3 className="font-display font-semibold text-ink text-lg">
            Write Your Meditation
          </h3>
        </div>

        {/* Best Verse */}
        <div className="mb-4">
          <label className="text-sm font-medium text-ink mb-1.5 block">Best Verse</label>
          <p className="text-xs text-stone mb-2">Your best verse of the day</p>
          <textarea
            value={bestVerse}
            onChange={(e) => { setBestVerse(e.target.value); setSavedMeditation(false); }}
            className="input-field min-h-[60px] resize-y font-serif"
            placeholder="Enter your best verse of the day…"
          />
        </div>

        {/* Daily Meditation (50-100 words) */}
        <div className="mb-4">
          <label className="text-sm font-medium text-ink mb-1.5 block">Daily Meditation</label>
          <p className="text-xs text-stone mb-2">At least 50 words</p>
          <textarea
            value={meditation}
            onChange={(e) => { setMeditation(e.target.value); setSavedMeditation(false); }}
            className="input-field min-h-[120px] resize-y font-serif"
            placeholder="Write your meditation on today's reading (50–100 words)…"
          />
          <p className={cn('text-xs mt-1', meditationWordCount < 50 ? 'text-roman' : 'text-moss')}>
            {meditationWordCount} words {meditationWordCount < 50 && '(need 50+)'}
          </p>
        </div>

        {/* Daily Quote (max 10 words) */}
        <div className="mb-4">
          <label className="text-sm font-medium text-ink mb-1.5 block">Daily Quote</label>
          <p className="text-xs text-stone mb-2">No more than 10 words</p>
          <input
            type="text"
            value={dailyQuote}
            onChange={(e) => { setDailyQuote(e.target.value); setSavedMeditation(false); }}
            className="input-field font-serif"
            placeholder="Your daily quote (max 10 words)…"
          />
          <p className={cn('text-xs mt-1', quoteWordCount > 10 ? 'text-roman' : 'text-stone')}>
            {quoteWordCount} words {quoteWordCount > 10 && '(max 10!)'}
          </p>
        </div>

        <div className="flex items-center justify-between mt-3">
          {savedMeditation ? (
            <span className="text-sm text-moss flex items-center gap-1.5">
              <CheckCircle2 size={16} strokeWidth={1.5} /> Meditation submitted — streak protected
            </span>
          ) : (
            <span className="text-sm text-stone">
              All three sections required
            </span>
          )}
          <button
            onClick={saveMeditation}
            disabled={!canSubmitMeditation || saving}
            className="btn-primary disabled:opacity-50"
          >
            <Save size={16} strokeWidth={1.5} /> {saving ? 'Saving…' : 'Submit Meditation'}
          </button>
        </div>
      </div>}

      {isSundayRest && (
        <div className="card p-4 sm:p-5 animate-slide-up bg-surface border-border">
          <div className="flex items-center gap-2">
            <Sun size={18} className="text-brass" strokeWidth={1.5} />
            <span className="eyebrow text-stone">Day of Rest</span>
          </div>
          <p className="mt-3 text-sm text-stone">
            No daily meditation is required on Sunday. Receive the Verse of the Day, rest, and return tomorrow.
          </p>
        </div>
      )}

      {/* ── Challenge — format-aware + reject/resubmit flow ── */}
      {!isSundayRest && narrative.challenge_active && narrative.challenge_title && (
        <div className="card p-4 sm:p-5 animate-slide-up bg-surface-2 border-border">
          <div className="flex items-center justify-between gap-3 mb-1">
            <span className="eyebrow text-stone">Daily Challenge</span>
            <span className="badge badge-roman">5% ranking</span>
          </div>
          <div className="flex items-center gap-2 mt-3 mb-2">
            <Target size={18} className="text-roman" strokeWidth={1.5} />
            <h3 className="font-display font-semibold text-ink text-lg">
              {narrative.challenge_title}
            </h3>
          </div>
          <p className="preserve-paragraphs text-sm text-stone mb-2">
            {narrative.challenge_instructions}
          </p>
          <div className="flex items-center gap-1.5 text-xs text-stone mb-4">
            {proofFormat === 'link' ? <Link2 size={12} /> : proofFormat === 'text' ? <FileText size={12} /> : <ImageIcon size={12} />}
            <span>Suggested evidence: <span className="font-medium text-ink">{proofFormatLabel(proofFormat)}</span></span>
          </div>

          {/* Rejection notice */}
          {challengeRejected && (
            <div className="p-3 rounded-lg bg-coral-soft border border-coral/30 mb-4 animate-slide-up">
              <div className="flex items-start gap-2">
                <AlertCircle size={16} className="text-coral flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-coral">Your submission was rejected</p>
                  {challenge?.rejection_reason && (
                    <p className="preserve-paragraphs text-xs text-coral/80 mt-1">{challenge.rejection_reason}</p>
                  )}
                  <p className="text-xs text-coral/60 mt-1">Please fix the issue and resubmit below.</p>
                </div>
              </div>
            </div>
          )}

          {/* Approved notice */}
          {challengeApproved && (
            <div className="space-y-3 mb-4">
              <div className="p-3 rounded-lg bg-sage-soft border border-sage/30 animate-slide-up">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={16} className="text-sage" />
                  <p className="text-sm font-medium text-sage">Challenge approved!</p>
                </div>
              </div>
              <ChallengeEvidenceList items={challenge?.evidence_items || []} legacyText={challenge?.proof_text} />
            </div>
          )}

          {/* Submission input */}
          {!challengeApproved && (
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink">Written evidence</label>
                <textarea
                  value={challengeText}
                  onChange={(e) => { setChallengeText(e.target.value); setChallengeSaved(false); }}
                  className="input-field min-h-[100px] resize-y"
                  placeholder="Write your evidence, explanation, or testimony..."
                />
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <label className="text-sm font-medium text-ink">Links</label>
                  <button
                    type="button"
                    onClick={() => setChallengeLinks((links) => [...links, ''])}
                    className="btn-ghost px-2 py-1 text-xs"
                  >
                    <Plus size={13} /> Add link
                  </button>
                </div>
                <div className="space-y-2">
                  {challengeLinks.map((link, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <Link2 size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone" />
                        <input
                          type="url"
                          value={link}
                          onChange={(event) => {
                            const next = [...challengeLinks];
                            next[index] = event.target.value;
                            setChallengeLinks(next);
                            setChallengeSaved(false);
                          }}
                          className="input-field pl-9"
                          placeholder="https://your-evidence-link.com"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setChallengeLinks((links) => links.length === 1 ? [''] : links.filter((_, itemIndex) => itemIndex !== index));
                          setChallengeSaved(false);
                        }}
                        className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg text-stone hover:bg-coral/10 hover:text-coral"
                        title="Remove link"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
                {hasInvalidChallengeLink && (
                  <p className="mt-1 text-xs text-coral">Links must begin with http:// or https://.</p>
                )}
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink">Pictures and documents</label>
                {challengeFiles.length > 0 && (
                  <div className="mb-2">
                    <ChallengeEvidenceList
                      items={challengeFiles}
                      onRemove={(id) => {
                        setChallengeFiles((files) => files.filter((file) => file.id !== id));
                        setChallengeSaved(false);
                      }}
                    />
                  </div>
                )}
                {pendingChallengeFiles.length > 0 && (
                  <div className="space-y-2 mb-2">
                    {pendingChallengeFiles.map((pending) => (
                      <div key={pending.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3">
                        <div className="flex min-w-0 items-center gap-2">
                          {pending.file.type.startsWith('image/') ? <ImageIcon size={17} className="text-brass" /> : <FileText size={17} className="text-brass" />}
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold text-ink">{pending.file.name}</p>
                            <p className="text-[10px] text-stone">{Math.max(1, Math.round(pending.file.size / 1024))} KB</p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setPendingChallengeFiles((files) => files.filter((file) => file.id !== pending.id))}
                          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-stone hover:bg-coral/10 hover:text-coral"
                          title="Remove file"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-5 transition-colors hover:border-brass">
                  <Upload size={19} className="text-brass" />
                  <span className="text-sm font-medium text-ink">Add pictures or documents</span>
                  <input
                    type="file"
                    accept="image/*,.pdf,.doc,.docx,.txt,.rtf,.odt"
                    multiple
                    className="hidden"
                    onChange={(event) => {
                      const selected = Array.from(event.target.files || []);
                      event.target.value = '';
                      if (challengeFiles.length + pendingChallengeFiles.length + selected.length > 10) {
                        alert('You can attach up to 10 files to one challenge.');
                        return;
                      }
                      const tooLarge = selected.find((file) => file.size > 10 * 1024 * 1024);
                      if (tooLarge) {
                        alert(`${tooLarge.name} is larger than 10 MB.`);
                        return;
                      }
                      setPendingChallengeFiles((files) => [
                        ...files,
                        ...selected.map((file) => ({ id: crypto.randomUUID(), file })),
                      ]);
                      setChallengeSaved(false);
                    }}
                  />
                </label>
                <p className="mt-1.5 flex items-center gap-1 text-[10px] text-stone">
                  <Paperclip size={11} /> Up to 10 files, 10 MB each
                </p>
              </div>

              <div className="flex flex-col gap-3 border-t border-border pt-3 min-[520px]:flex-row min-[520px]:items-center min-[520px]:justify-between">
                {challengeSaved && !challengeRejected ? (
                  <span className="text-sm text-moss flex items-center gap-1.5">
                    <CheckCircle2 size={16} strokeWidth={1.5} /> Submitted and pending review
                  </span>
                ) : challengeRejected ? (
                  <span className="text-sm text-coral flex items-center gap-1.5">
                    <RefreshCw size={16} strokeWidth={1.5} /> Ready to resubmit
                  </span>
                ) : (
                  <span className="text-sm text-stone">
                    Add any combination of evidence
                  </span>
                )}
                <button
                  onClick={saveChallenge}
                  disabled={!challengeHasEvidence || hasInvalidChallengeLink || saving}
                  className="btn-secondary disabled:opacity-50"
                >
                  <Sparkles size={16} strokeWidth={1.5} /> {saving ? 'Uploading...' : challengeRejected ? 'Resubmit' : challengeSaved ? 'Update Submission' : 'Submit Challenge'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function proofFormatLabel(format: ChallengeProofFormat): string {
  const map: Record<ChallengeProofFormat, string> = {
    text: 'Text write-up',
    png: 'PNG image',
    pdf: 'PDF document',
    image: 'Image file',
    link: 'External link',
  };
  return map[format] || format;
}

function FlameIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  return <span className={className} style={{ fontSize: size, display: 'inline-block' }}>&#128293;</span>;
}
