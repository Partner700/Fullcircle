import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { EmptyState } from '../../components/AppShell';
import { ScrollEdge, SealBullet } from '../../components/AncientMotifs';
import { ChallengeEvidenceList } from '../../components/ChallengeEvidenceList';
import { PanelImageBackdrop } from '../../components/PanelImageBackdrop';
import { fetchNarrative, fetchChallengeSubmission, fetchPanelImageSetting, upsertChallengeSubmission } from '../../lib/queries';
import { supabase } from '../../lib/supabase';
import { getDayType, getTodayISODate, cn } from '../../lib/utils';
import { MEDITATION_CUTOFF_HOUR, MEDITATION_CUTOFF_MINUTE } from '../../lib/constants';
import type { DailyNarrative, ChallengeSubmission, ChallengeProofFormat, PanelImageSetting } from '../../lib/types';
import {
  BookOpen, BookMarked, Lightbulb, Target, CheckCircle2, Save, Sparkles,
  Quote, ScrollText, Sun, Link2, Image as ImageIcon,
  AlertCircle, RefreshCw, FileText,
} from 'lucide-react';

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
  const [challengeLink, setChallengeLink] = useState('');
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
    const [narr, chal, panelImage] = await Promise.all([
      fetchNarrative(today),
      fetchChallengeSubmission(profile.id, today),
      fetchPanelImageSetting('reading').catch(() => null),
    ]);
    setNarrative(narr);
    setChallenge(chal);
    setReadingImage(panelImage);
    if (chal?.proof_text) {
      if (narr?.challenge_proof_format === 'link') setChallengeLink(chal.proof_text);
      else setChallengeText(chal.proof_text);
    }

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
    const format = narrative?.challenge_proof_format || 'text';
    const proof = format === 'link' ? challengeLink.trim() : challengeText.trim();
    if (!proof) return;
    setSaving(true);
    // If previous submission was rejected, delete it first so the new one can be inserted
    if (challenge?.status === 'rejected') {
      await supabase.from('challenge_submissions').delete().eq('id', challenge.id);
    }
    await upsertChallengeSubmission({
      user_id: profile.id,
      narrative_date: today,
      proof_text: proof,
      proof_type: format,
      status: 'pending',
      submitted_at: new Date().toISOString(),
    });
    setChallengeSaved(true);
    setSaving(false);
    load();
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

  return (
    <div className="space-y-5 animate-fade-in max-w-3xl mx-auto">
      {/* ── Header card — scripture reference + theme ── */}
      <div className="card relative overflow-hidden p-4 sm:p-5 animate-slide-up bg-surface-2 border-border">
        <PanelImageBackdrop image={readingImage} veilClassName="bg-surface-2/75" />
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
        <div className="card p-5 animate-slide-up bg-surface-2 border-brass/30">
          <div className="flex items-center gap-2 mb-3">
            <Sun size={18} className="text-brass" strokeWidth={1.5} />
            <span className="eyebrow text-stone">Verse of the Day</span>
          </div>
          <ScrollEdge position="top" className="text-brass mb-3" />
          <p className="font-display text-xl text-ink leading-snug font-serif">
            &ldquo;{narrative.verse_of_day}&rdquo;
          </p>
          <ScrollEdge position="bottom" className="text-brass mt-3" />
        </div>
      )}

      {/* ── Scripture text ── */}
      <div className="card p-5 animate-slide-up bg-surface border-border">
        <div className="flex items-center gap-2 mb-3">
          <ScrollText size={18} className="text-brass" strokeWidth={1.5} />
          <span className="eyebrow text-stone">Scripture</span>
        </div>
        <ScrollEdge position="top" className="text-brass mb-4" />
        <div className="prose prose-sm max-w-none">
          <p className="text-ink leading-relaxed whitespace-pre-wrap font-serif text-[15px]">
            {narrative.main_text}
          </p>
        </div>
        <ScrollEdge position="bottom" className="text-brass mt-4" />
      </div>

      {/* ── Highlighted verses ── */}
      {narrative.highlighted_verses && narrative.highlighted_verses.length > 0 && (
        <div className="card p-5 animate-slide-up bg-surface border-border">
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
                <p className="font-display text-2xl text-ink leading-snug">
                  &ldquo;{v.text}&rdquo;
                </p>
                <p className="text-xs text-brass font-medium mt-2 eyebrow">
                  {v.reference}
                </p>
                <p className="text-sm text-stone mt-3 leading-relaxed">
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
        <div className="card p-5 animate-slide-up bg-surface border-border">
          <div className="flex items-center gap-2 mb-4">
            <Lightbulb size={18} className="text-moss" strokeWidth={1.5} />
            <span className="eyebrow text-stone">Reflection Prompts</span>
          </div>
          <ul className="space-y-2.5">
            {narrative.reflection_prompts.map((prompt, i) => (
              <li key={i} className="flex gap-3 items-start">
                <SealBullet className="text-brass flex-shrink-0 mt-1.5" />
                <p className="text-sm text-ink leading-relaxed">{prompt}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Meditation submission — three sections ── */}
      {!isSundayRest && <div className="card p-5 animate-slide-up bg-surface border-border">
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
        <div className="card p-5 animate-slide-up bg-surface border-border">
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
        <div className="card p-5 animate-slide-up bg-surface-2 border-border">
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
          <p className="text-sm text-stone mb-2">
            {narrative.challenge_instructions}
          </p>
          <div className="flex items-center gap-1.5 text-xs text-stone mb-4">
            {proofFormat === 'link' ? <Link2 size={12} /> : proofFormat === 'text' ? <FileText size={12} /> : <ImageIcon size={12} />}
            <span>Submit as: <span className="font-medium text-ink">{proofFormatLabel(proofFormat)}</span></span>
          </div>

          {/* Rejection notice */}
          {challengeRejected && (
            <div className="p-3 rounded-lg bg-coral-soft border border-coral/30 mb-4 animate-slide-up">
              <div className="flex items-start gap-2">
                <AlertCircle size={16} className="text-coral flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-coral">Your submission was rejected</p>
                  {challenge?.rejection_reason && (
                    <p className="text-xs text-coral/80 mt-1">{challenge.rejection_reason}</p>
                  )}
                  <p className="text-xs text-coral/60 mt-1">Please fix the issue and resubmit below.</p>
                </div>
              </div>
            </div>
          )}

          {/* Approved notice */}
          {challengeApproved && (
            <div className="p-3 rounded-lg bg-sage-soft border border-sage/30 mb-4 animate-slide-up">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={16} className="text-sage" />
                <p className="text-sm font-medium text-sage">Challenge approved!</p>
              </div>
            </div>
          )}

          {/* Submission input — format-aware */}
          {!challengeApproved && (
            <>
              {proofFormat === 'link' ? (
                <input
                  type="url"
                  value={challengeLink}
                  onChange={(e) => { setChallengeLink(e.target.value); setChallengeSaved(false); }}
                  className="input-field"
                  placeholder="https://your-proof-link.com/…"
                />
              ) : proofFormat === 'text' ? (
                <textarea
                  value={challengeText}
                  onChange={(e) => { setChallengeText(e.target.value); setChallengeSaved(false); }}
                  className="input-field min-h-[80px] resize-y"
                  placeholder="Write your challenge proof…"
                />
              ) : (
                <div className="space-y-2">
                  <label className="flex items-center justify-center gap-2 p-6 rounded-lg border-2 border-dashed border-border hover:border-brass cursor-pointer transition-colors">
                    <ImageIcon size={20} className="text-stone" />
                    <span className="text-sm text-stone">Upload your {proofFormat.toUpperCase()} file</span>
                    <input
                      type="file"
                      accept={proofFormat === 'png' ? 'image/png' : proofFormat === 'pdf' ? 'application/pdf' : 'image/*'}
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          setChallengeText(`[File: ${file.name} — ${Math.round(file.size / 1024)}KB]`);
                          setChallengeSaved(false);
                        }
                      }}
                    />
                  </label>
                  {challengeText && (
                    <p className="text-xs text-moss flex items-center gap-1">
                      <CheckCircle2 size={12} /> {challengeText}
                    </p>
                  )}
                  <p className="text-[10px] text-stone">
                    File uploads are stored as proof references. In production, this would upload to Supabase Storage.
                  </p>
                </div>
              )}

              <div className="flex items-center justify-between mt-3">
                {challengeSaved && !challengeRejected ? (
                  <span className="text-sm text-moss flex items-center gap-1.5">
                    <CheckCircle2 size={16} strokeWidth={1.5} /> Submitted — pending review
                  </span>
                ) : challengeRejected ? (
                  <span className="text-sm text-coral flex items-center gap-1.5">
                    <RefreshCw size={16} strokeWidth={1.5} /> Ready to resubmit
                  </span>
                ) : (
                  <span className="text-sm text-stone">
                    Counts toward monthly ranking
                  </span>
                )}
                <button
                  onClick={saveChallenge}
                  disabled={(proofFormat === 'link' ? !challengeLink.trim() : !challengeText.trim()) || saving}
                  className="btn-secondary disabled:opacity-50"
                >
                  <Sparkles size={16} strokeWidth={1.5} /> {saving ? 'Saving…' : challengeRejected ? 'Resubmit' : 'Submit Challenge'}
                </button>
              </div>
            </>
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
