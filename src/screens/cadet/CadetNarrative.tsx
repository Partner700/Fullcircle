import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { EmptyState } from '../../components/AppShell';
import { ScrollEdge, SealBullet } from '../../components/AncientMotifs';
import { PanelImageBackdrop } from '../../components/PanelImageBackdrop';
import { AppSelect } from '../../components/AppSelect';
import { addVerseInsightComment, editVerseInsight, editVerseInsightComment, fetchCampMentionCandidates, fetchNarrative, fetchNarratives, fetchChallengeSubmission, fetchPanelImageSetting, fetchVerseInsights, recordSundayReadingOpen, saveVerseInsight, uploadChallengeEvidence, upsertChallengeSubmission } from '../../lib/queries';
import { supabase } from '../../lib/supabase';
import { getDayType, getTodayISODate, getAppClock, cn } from '../../lib/utils';
import { MEDITATION_CUTOFF_HOUR, MEDITATION_CUTOFF_MINUTE } from '../../lib/constants';
import type { DailyNarrative, ChallengeSubmission, ChallengeProofFormat, PanelImageSetting } from '../../lib/types';
import type { CampMentionCandidate } from '../../lib/queries';
import { clearScriptureTarget, readScriptureTarget, type ScriptureNavigationTarget } from '../../lib/scriptureNavigation';
import {
  BookOpen, BookMarked, Lightbulb, Target, CheckCircle2, Save, Sparkles,
  ScrollText, Sun, Link2, Image as ImageIcon,
  AlertCircle, RefreshCw, FileText,
  MessageCircle, Reply, Send, Pencil, Check,
} from 'lucide-react';

function splitScriptureVerses(text: string) {
  const compact = text.replace(/\r/g, '').replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
  const matches = Array.from(compact.matchAll(/(?:^|\s)(\d{1,3})[.)]?\s+(.+?)(?=(?:\s+\d{1,3}[.)]?\s+(?=[A-Z“\"]|$))|$)/g));
  if (matches.length >= 2) {
    return matches.map((match) => ({ number: match[1], text: match[2].trim() })).filter((verse) => verse.text);
  }
  return text.split(/\n{2,}/).filter(Boolean).map((paragraph, index) => ({ number: String(index + 1), text: paragraph.trim() }));
}

type ScriptureVerse = { reference: string; text: string; meditation: string };

function MentionTextarea({
  value,
  onChange,
  candidates,
  className,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  candidates: CampMentionCandidate[];
  className: string;
  placeholder: string;
}) {
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [cursorPosition, setCursorPosition] = useState(0);
  const visibleCandidates = mentionQuery === null ? [] : candidates
    .filter((candidate) => candidate.display_name.toLowerCase().includes(mentionQuery.toLowerCase()))
    .slice(0, 10);

  const updateMentionQuery = (nextValue: string, cursor: number) => {
    const match = nextValue.slice(0, cursor).match(/(?:^|\s)@([^@\n]{0,40})$/);
    setMentionQuery(match ? match[1] : null);
    setCursorPosition(cursor);
  };

  const insertMention = (candidate: CampMentionCandidate) => {
    const beforeCursor = value.slice(0, cursorPosition);
    const mentionStart = beforeCursor.lastIndexOf('@');
    if (mentionStart < 0) return;
    onChange(`${value.slice(0, mentionStart)}@${candidate.display_name} ${value.slice(cursorPosition)}`);
    setMentionQuery(null);
  };

  return (
    <div className="relative">
      <textarea
        className={className}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          updateMentionQuery(event.target.value, event.target.selectionStart || event.target.value.length);
        }}
        onClick={(event) => updateMentionQuery(event.currentTarget.value, event.currentTarget.selectionStart || 0)}
        onBlur={() => window.setTimeout(() => setMentionQuery(null), 140)}
        placeholder={placeholder}
      />
      {mentionQuery !== null && (
        <div className="absolute inset-x-0 top-full z-40 mt-1 max-h-64 overflow-y-auto rounded-xl border border-border bg-surface p-1.5 shadow-2xl">
          {visibleCandidates.length ? visibleCandidates.map((candidate) => (
            <button
              key={candidate.user_id}
              type="button"
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-peri-soft"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => insertMention(candidate)}
            >
              <span className="h-8 w-8 flex-shrink-0 overflow-hidden rounded-full border border-border bg-peri-soft text-center text-xs font-bold leading-8 text-peri">
                {candidate.avatar_url ? <img src={candidate.avatar_url} alt="" className="h-full w-full object-cover" /> : candidate.display_name.charAt(0)}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-xs font-bold text-ink">{candidate.display_name}</span>
                <span className="block text-[10px] capitalize text-stone">{candidate.role}</span>
              </span>
            </button>
          )) : <p className="px-3 py-2 text-xs text-stone">No camp member matches that name.</p>}
        </div>
      )}
    </div>
  );
}

function mentionedUserIds(body: string, candidates: CampMentionCandidate[]) {
  const normalizedBody = body.toLocaleLowerCase();
  return candidates
    .filter((candidate) => normalizedBody.includes(`@${candidate.display_name.toLocaleLowerCase()}`))
    .map((candidate) => candidate.user_id);
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
  const [challengeLink, setChallengeLink] = useState('');
  const [challengeSaved, setChallengeSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [readingImage, setReadingImage] = useState<PanelImageSetting | null>(null);
  const [challengeImage, setChallengeImage] = useState<PanelImageSetting | null>(null);
  const [meditationImage, setMeditationImage] = useState<PanelImageSetting | null>(null);
  const [openVerse, setOpenVerse] = useState<number | null>(null);
  const [readerVerses, setReaderVerses] = useState<ScriptureVerse[]>([]);
  const [verseInsights, setVerseInsights] = useState<any[]>([]);
  const [openUserInsights, setOpenUserInsights] = useState<string | null>(null);
  const [myInsightDrafts, setMyInsightDrafts] = useState<Record<string, string>>({});
  const [savingInsight, setSavingInsight] = useState<string | null>(null);
  const [openInsightReplies, setOpenInsightReplies] = useState<string | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [replyTargets, setReplyTargets] = useState<Record<string, { userId: string; displayName: string; parentCommentId?: string } | null>>({});
  const [savingReply, setSavingReply] = useState<string | null>(null);
  const [editingInsightId, setEditingInsightId] = useState<string | null>(null);
  const [editingInsightBody, setEditingInsightBody] = useState('');
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentBody, setEditingCommentBody] = useState('');
  const [campMentionCandidates, setCampMentionCandidates] = useState<CampMentionCandidate[]>([]);
  const [uploadingEvidence, setUploadingEvidence] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [readingHistory, setReadingHistory] = useState<(DailyNarrative & { meditation_text: string | null; best_verse: string | null; daily_quote: string | null })[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [navigationTarget, setNavigationTarget] = useState<ScriptureNavigationTarget | null>(() => readScriptureTarget());
  const verseRefs = useRef<Record<string, HTMLElement | null>>({});

  const today = getTodayISODate();
  const dayType = getDayType(new Date());
  const isSundayRest = dayType === 'sunday';

  const load = useCallback(async () => {
    if (!profile) { setLoading(false); return; }
    setLoading(true);
    try {
    const [narr, chal, panelImage, challengePanelImage, meditationPanelImage] = await Promise.all([
      fetchNarrative(today),
      fetchChallengeSubmission(profile.id, today),
      fetchPanelImageSetting('reading').catch(() => null),
      fetchPanelImageSetting('challenge').catch(() => null),
      fetchPanelImageSetting('meditation').catch(() => null),
    ]);
    setNarrative(narr);
    setChallenge(chal);
    setReadingImage(panelImage);
    setChallengeImage(challengePanelImage);
    setMeditationImage(meditationPanelImage);
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

  useEffect(() => {
    let cancelled = false;
    fetchCampMentionCandidates()
      .then((candidates) => { if (!cancelled) setCampMentionCandidates(candidates); })
      .catch(() => { if (!cancelled) setCampMentionCandidates([]); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!profile || !isSundayRest) return;
    let cancelled = false;
    const creditSundayReading = async () => {
      try {
        const credited = await recordSundayReadingOpen(profile.id, today);
        if (credited && !cancelled) await onMeditationSaved?.();
      } catch (error) {
        console.error('Sunday reading streak credit failed:', error);
      }
    };
    void creditSundayReading();
    return () => { cancelled = true; };
  }, [isSundayRest, onMeditationSaved, profile, today]);

  const loadHistory = async () => {
    if (!profile || historyLoading) return;
    setHistoryLoading(true);
    try {
      const [pastNarratives, recordsResult] = await Promise.all([
        fetchNarratives(90),
        supabase.from('daily_records').select('record_date,meditation_text,best_verse,daily_quote').eq('user_id', profile.id).order('record_date', { ascending: false }),
      ]);
      const recordByDate = new Map((recordsResult.data || []).map((record) => [record.record_date, record]));
      setReadingHistory(pastNarratives
        .filter((item) => item.narrative_date < today)
        .map((item) => ({ ...item, ...(recordByDate.get(item.narrative_date) || { meditation_text: null, best_verse: null, daily_quote: null }) })));
    } catch (error) {
      console.error('Reading history load error:', error);
    }
    setHistoryLoading(false);
  };

  useEffect(() => {
    if (!narrative) return;
    const savedVerses = narrative.highlighted_verses || [];
    if (savedVerses.length > 1) {
      setReaderVerses(savedVerses);
      return;
    }

    let cancelled = false;
    const fetchFullPassage = async () => {
      try {
        const response = await fetch(`https://bible-api.com/${encodeURIComponent(narrative.scripture_reference)}?translation=${narrative.translation || 'web'}`);
        const data = await response.json();
        if (!response.ok || !Array.isArray(data.verses) || data.verses.length === 0) throw new Error('No verses');
        const notesByReference = new Map(savedVerses.map((verse) => [verse.reference, verse.meditation]));
        const verses = data.verses.map((verse: { book_name: string; chapter: number; verse: number; text: string }) => {
          const reference = `${verse.book_name} ${verse.chapter}:${verse.verse}`;
          return { reference, text: String(verse.text || '').trim(), meditation: notesByReference.get(reference) || '' };
        });
        if (!cancelled) setReaderVerses(verses);
      } catch {
        if (!cancelled) setReaderVerses(savedVerses);
      }
    };
    fetchFullPassage();
    return () => { cancelled = true; };
  }, [narrative]);

  useEffect(() => {
    if (!narrative?.id) return;
    let cancelled = false;
    fetchVerseInsights(narrative.id).then((items) => {
      if (!cancelled) {
        setVerseInsights(items);
        const drafts: Record<string, string> = {};
        items.filter((item: any) => item.user_id === profile?.id).forEach((item: any) => { drafts[item.verse_reference] = item.body || ''; });
        setMyInsightDrafts(drafts);
      }
    });
    return () => { cancelled = true; };
  }, [narrative?.id, profile?.id]);

  useEffect(() => {
    const receiveTarget = (event: Event) => setNavigationTarget((event as CustomEvent<ScriptureNavigationTarget>).detail);
    window.addEventListener('full-circle-open-scripture', receiveTarget);
    return () => window.removeEventListener('full-circle-open-scripture', receiveTarget);
  }, []);

  useEffect(() => {
    if (!navigationTarget || !narrative?.id || readerVerses.length === 0) return;
    if (navigationTarget.narrativeId && navigationTarget.narrativeId !== narrative.id) return;
    const targetedInsight = navigationTarget.insightId
      ? verseInsights.find((item: any) => item.id === navigationTarget.insightId)
      : null;
    const reference = navigationTarget.verseReference || targetedInsight?.verse_reference;
    if (!reference) return;
    const index = readerVerses.findIndex((verse) => verse.reference === reference);
    if (index < 0) return;
    setOpenVerse(index);
    setOpenUserInsights(reference);
    window.setTimeout(() => verseRefs.current[reference]?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120);
    clearScriptureTarget();
    setNavigationTarget(null);
  }, [navigationTarget, narrative?.id, readerVerses, verseInsights]);

  const meditationWordCount = meditation.trim() ? meditation.trim().split(/\s+/).length : 0;
  const quoteWordCount = dailyQuote.trim() ? dailyQuote.trim().split(/\s+/).length : 0;
  const appClock = getAppClock();
  const afterMeditationCutoff =
    appClock.hour > MEDITATION_CUTOFF_HOUR ||
    (appClock.hour === MEDITATION_CUTOFF_HOUR && appClock.minute >= MEDITATION_CUTOFF_MINUTE);
  const canSubmitMeditation =
    !afterMeditationCutoff &&
    bestVerse.trim().length > 0 &&
    meditationWordCount >= 50 &&
    quoteWordCount > 0 &&
    quoteWordCount <= 10;

  const saveMeditation = async () => {
    if (!profile || !canSubmitMeditation) return;
    setSaving(true);
    const { error } = await supabase.rpc('submit_daily_meditation', {
      p_record_date: today,
      p_meditation_text: meditation.trim(),
      p_best_verse: bestVerse.trim(),
      p_daily_quote: dailyQuote.trim(),
    });
    if (error) {
      alert(error.message || 'Meditation could not be saved.');
      setSaving(false);
      return;
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

  const submitVerseInsight = async (reference: string) => {
    if (!profile || !narrative?.id) return;
    const body = (myInsightDrafts[reference] || '').trim();
    if (!body) return;
    setSavingInsight(reference);
    try {
      await saveVerseInsight(narrative.id, profile.id, reference, body, mentionedUserIds(body, campMentionCandidates));
      setVerseInsights(await fetchVerseInsights(narrative.id));
      setOpenUserInsights(reference);
      setMyInsightDrafts((current) => ({ ...current, [reference]: '' }));
    } catch (error: any) {
      alert(error.message || 'Could not save your insight.');
    }
    setSavingInsight(null);
  };

  const submitInsightReply = async (insight: any) => {
    if (!profile || !narrative?.id) return;
    const body = (replyDrafts[insight.id] || '').trim();
    if (!body) return;
    const target = replyTargets[insight.id];
    setSavingReply(insight.id);
    try {
      await addVerseInsightComment({
        insightId: insight.id,
        userId: profile.id,
        body,
        mentionedUserId: target?.userId || insight.user_id,
        mentionedUserIds: mentionedUserIds(body, campMentionCandidates),
        parentCommentId: target?.parentCommentId || null,
      });
      setVerseInsights(await fetchVerseInsights(narrative.id));
      setReplyDrafts((current) => ({ ...current, [insight.id]: '' }));
      setReplyTargets((current) => ({ ...current, [insight.id]: null }));
      setOpenInsightReplies(insight.id);
    } catch (error: any) {
      alert(error.message || 'Could not post your reply.');
    }
    setSavingReply(null);
  };

  const submitInsightEdit = async () => {
    if (!editingInsightId || !editingInsightBody.trim() || !narrative?.id) return;
    try {
      await editVerseInsight(editingInsightId, editingInsightBody.trim());
      setEditingInsightId(null);
      setEditingInsightBody('');
      setVerseInsights(await fetchVerseInsights(narrative.id));
    } catch (error: any) { alert(error.message || 'Could not edit your insight.'); }
  };

  const submitInsightCommentEdit = async () => {
    if (!editingCommentId || !editingCommentBody.trim() || !narrative?.id) return;
    try {
      await editVerseInsightComment(editingCommentId, editingCommentBody.trim());
      setEditingCommentId(null);
      setEditingCommentBody('');
      setVerseInsights(await fetchVerseInsights(narrative.id));
    } catch (error: any) { alert(error.message || 'Could not edit your reply.'); }
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
      <div className="space-y-5 max-w-3xl mx-auto"><EmptyState icon={BookOpen} title="No reading published" message="Today's narrative hasn't been published yet. Your previous readings remain available below." />
        <section className="card p-5"><div className="flex items-center justify-between gap-3"><div><p className="eyebrow text-stone">Reading Archive</p><p className="mt-1 text-sm text-ink">Previous readings, notes, and your meditations</p></div><button type="button" className="btn-secondary text-xs" onClick={() => { const next = !showHistory; setShowHistory(next); if (next) void loadHistory(); }}><BookOpen size={14} /> {showHistory ? 'Hide' : 'Open archive'}</button></div>{showHistory && <div className="mt-4 space-y-3">{historyLoading && <p className="text-xs text-stone">Loading your reading archive...</p>}{!historyLoading && readingHistory.map((item) => <details key={item.id} className="rounded-lg border border-border bg-surface-2 p-3"><summary className="cursor-pointer text-sm font-semibold text-ink">{item.title} · {item.narrative_date}</summary><p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-ink">{item.main_text}</p>{item.meditation_text && <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-stone">{item.meditation_text}</p>}</details>)}</div>}</section></div>
    );
  }

  const challengeRejected = challenge?.status === 'rejected';
  const challengeApproved = challenge?.status === 'approved';
  const proofFormat: ChallengeProofFormat = (narrative.challenge_proof_format as ChallengeProofFormat) || 'text';
  const displayVerses = readerVerses.length ? readerVerses : (narrative.highlighted_verses || []);
  const verseChoices = displayVerses.map((verse) => ({ value: verse.reference, label: verse.reference }));
  const fetchedVerses = splitScriptureVerses(narrative.main_text || '');

  return (
    <div className="today-reading-screen space-y-5 animate-fade-in max-w-3xl mx-auto">
      {/* ── Header card — scripture reference + theme ── */}
      <div
        className="card relative overflow-hidden p-4 sm:p-5 animate-slide-up border-border backdrop-blur-sm"
        style={{ background: 'color-mix(in srgb, var(--color-navy-3) 42%, transparent)', backdropFilter: 'blur(18px) saturate(1.18)' }}
      >
        <PanelImageBackdrop image={readingImage} opacityOverride={58} veilClassName="" />
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
        <div
          className="card reading-glass-panel relative overflow-hidden p-5 animate-slide-up border-brass/30"
          style={{
            backdropFilter: 'blur(26px) saturate(1.22)',
          }}
        >
          <div>
          <div className="flex items-center gap-2 mb-3">
            <Sun size={18} className="text-brass" strokeWidth={1.5} />
            <span className="eyebrow text-stone">Verse of the Day</span>
          </div>
          <ScrollEdge position="top" className="text-brass mb-3" />
          <p className="font-display text-xl text-ink leading-snug">
            &ldquo;{narrative.verse_of_day}&rdquo;
          </p>
          <ScrollEdge position="bottom" className="text-brass mt-3" />
          </div>
        </div>
      )}

      {/* ── Scripture text ── */}
      <div
        className="card reading-glass-panel p-5 animate-slide-up border-border"
        style={{
          backdropFilter: 'blur(26px) saturate(1.22)',
        }}
      >
        <div className="flex items-center gap-2 mb-3">
          <ScrollText size={18} className="text-brass" strokeWidth={1.5} />
          <span className="eyebrow text-stone">Scripture</span>
        </div>
        <ScrollEdge position="top" className="text-brass mb-4" />
        <div className="space-y-4 sm:space-y-5">
          {displayVerses.length ? displayVerses.map((verse, index) => {
            const userInsights = verseInsights.filter((item: any) => item.verse_reference === verse.reference);
            const hasInsight = Boolean(verse.meditation?.trim());
            const hasReaderInsight = userInsights.length > 0;
            const sharedByMe = userInsights.some((item: any) => item.user_id === profile?.id);
            const taggedMe = userInsights.some((item: any) =>
              (item.mentioned_user_ids || []).includes(profile?.id)
              || (item.comments || []).some((comment: any) =>
                comment.mentioned_user_id === profile?.id || (comment.mentioned_user_ids || []).includes(profile?.id),
              ),
            );
            const expanded = openVerse === index;
            const userExpanded = openUserInsights === verse.reference;
            const verseNumber = verse.reference.match(/:(\d+)(?:\D|$)/)?.[1] || String(index + 1);
            return (
              <article
                key={`${verse.reference}-${index}`}
                ref={(element) => { verseRefs.current[verse.reference] = element; }}
                data-verse-reference={verse.reference}
                className={cn(
                  'scroll-mt-28 overflow-hidden rounded-xl border border-transparent px-2 py-2 transition-colors duration-300 [overflow-anchor:none]',
                  taggedMe ? 'verse-highlight-tagged' : sharedByMe ? 'verse-highlight-mine' : (hasInsight || hasReaderInsight) ? 'verse-highlight-insight' : '',
                )}
              >
                <button
                  type="button"
                  onClick={() => hasInsight && setOpenVerse(expanded ? null : index)}
                  className={cn('w-full px-1 py-1 text-left transition-colors', hasInsight ? 'hover:bg-peri-soft cursor-pointer' : 'cursor-default')}
                  aria-expanded={hasInsight ? expanded : undefined}
                >
                  <p className="text-[15px] leading-8 text-ink"><span className="mr-1.5 font-bold text-brass">{verseNumber}.</span>{verse.text}</p>
                  <span className="mt-2 block text-[10px] font-bold uppercase tracking-widest text-brass">
                    {verse.reference}{hasInsight ? ' · Instructor annotation available' : ''}{userInsights.length ? ` · ${userInsights.length} reader insight${userInsights.length === 1 ? '' : 's'}` : ''}
                  </span>
                </button>
                {hasInsight && expanded && (
                  <div className="mt-3 border-l-2 border-brass/50 bg-brass-soft px-4 py-3 animate-slide-up">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-brass">Instructor insight</p>
                    <p className="mt-1 text-sm leading-relaxed text-ink whitespace-pre-wrap">{verse.meditation}</p>
                  </div>
                )}
                <div className="mt-3 rounded-xl border border-border bg-surface/70 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-stone">Reader insights</p>
                    <button type="button" className="btn-ghost px-2 py-1 text-[10px]" onClick={() => setOpenUserInsights(userExpanded ? null : verse.reference)}>
                      {userExpanded ? 'Close' : userInsights.length ? `Open ${userInsights.length}` : 'Add yours'}
                    </button>
                  </div>
                  {userExpanded && (
                    <div className="mt-3 space-y-3">
                      {userInsights.map((item: any) => {
                        const authorName = item.profiles?.display_name || 'Reader';
                        const comments = item.comments || [];
                        const repliesOpen = openInsightReplies === item.id;
                        return (
                          <div key={item.id} className="rounded-xl border border-border bg-surface-2 p-3">
                            <div className="flex items-start gap-2.5">
                              <div className="h-8 w-8 flex-shrink-0 overflow-hidden rounded-full border border-border bg-peri-soft text-center text-xs font-bold leading-8 text-peri">
                                {item.profiles?.avatar_url ? <img src={item.profiles.avatar_url} alt="" className="h-full w-full object-cover" /> : authorName.charAt(0)}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-bold text-ink">{authorName}{item.user_id === profile?.id ? ' · You' : ''}</p>
                                {editingInsightId === item.id ? (
                                  <div className="mt-1 flex items-end gap-2">
                                    <textarea value={editingInsightBody} onChange={(event) => setEditingInsightBody(event.target.value)} className="input-field min-h-16 flex-1 text-xs" autoFocus />
                                    <button type="button" onClick={() => void submitInsightEdit()} className="icon-btn" aria-label="Save insight"><Check size={13} /></button>
                                  </div>
                                ) : <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-stone">{item.body}</p>}
                                {item.user_id === profile?.id && editingInsightId !== item.id && <button type="button" className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-peri" onClick={() => { setEditingInsightId(item.id); setEditingInsightBody(item.body); }}><Pencil size={10} /> Edit</button>}
                              </div>
                            </div>
                            <button type="button" className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-peri" onClick={() => {
                              setOpenInsightReplies(repliesOpen ? null : item.id);
                              setReplyTargets((current) => ({ ...current, [item.id]: { userId: item.user_id, displayName: authorName } }));
                              setReplyDrafts((current) => ({ ...current, [item.id]: current[item.id] || `@${authorName} ` }));
                            }}>
                              <MessageCircle size={13} /> {comments.length ? `${comments.length} ${comments.length === 1 ? 'reply' : 'replies'}` : 'Reply'}
                            </button>
                            {repliesOpen && (
                              <div className="mt-3 space-y-2 border-l-2 border-peri/25 pl-3">
                                {comments.map((comment: any) => (
                                  <div key={comment.id} className="rounded-lg bg-surface/75 p-2">
                                    <p className="text-[11px] font-bold text-ink">{comment.profile?.display_name || 'Reader'}</p>
                                    {editingCommentId === comment.id ? (
                                      <div className="mt-1 flex items-end gap-2">
                                        <textarea value={editingCommentBody} onChange={(event) => setEditingCommentBody(event.target.value)} className="input-field min-h-14 flex-1 text-xs" autoFocus />
                                        <button type="button" onClick={() => void submitInsightCommentEdit()} className="icon-btn" aria-label="Save reply"><Check size={12} /></button>
                                      </div>
                                    ) : <p className="mt-0.5 whitespace-pre-wrap text-xs leading-relaxed text-stone">{comment.body}</p>}
                                    {comment.user_id === profile?.id && editingCommentId !== comment.id && <button type="button" className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-peri" onClick={() => { setEditingCommentId(comment.id); setEditingCommentBody(comment.body); }}><Pencil size={10} /> Edit</button>}
                                    <button type="button" className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-peri" onClick={() => {
                                      const displayName = comment.profile?.display_name || 'Reader';
                                      setReplyTargets((current) => ({ ...current, [item.id]: { userId: comment.user_id, displayName, parentCommentId: comment.id } }));
                                      setReplyDrafts((current) => ({ ...current, [item.id]: `@${displayName} ` }));
                                    }}><Reply size={11} /> Reply</button>
                                  </div>
                                ))}
                                {replyTargets[item.id] && <p className="text-[10px] font-semibold text-peri">Replying to @{replyTargets[item.id]?.displayName}</p>}
                                <div className="flex items-end gap-2">
                                  <div className="min-w-0 flex-1">
                                    <MentionTextarea className="input-field min-h-[4rem] w-full text-xs" value={replyDrafts[item.id] || ''} onChange={(value) => setReplyDrafts((current) => ({ ...current, [item.id]: value }))} candidates={campMentionCandidates} placeholder={`Respond to @${authorName}...`} />
                                  </div>
                                  <button type="button" className="icon-btn mb-1" aria-label="Post reply" disabled={savingReply === item.id || !(replyDrafts[item.id] || '').trim()} onClick={() => void submitInsightReply(item)}><Send size={15} /></button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                      <MentionTextarea
                        className="input-field min-h-[5.5rem] w-full text-sm"
                        value={myInsightDrafts[verse.reference] || ''}
                        onChange={(value) => setMyInsightDrafts((prev) => ({ ...prev, [verse.reference]: value }))}
                        candidates={campMentionCandidates}
                        placeholder="Write your insight on this verse. Type @ to tag someone..."
                      />
                      <button type="button" className="btn-secondary text-xs" disabled={savingInsight === verse.reference || !(myInsightDrafts[verse.reference] || '').trim()} onClick={() => submitVerseInsight(verse.reference)}>
                        {savingInsight === verse.reference ? 'Saving...' : 'Save my insight'}
                      </button>
                    </div>
                  )}
                </div>
              </article>
            );
          }) : fetchedVerses.map((verse, index) => (
            <article key={`${verse.number}-${index}`} className="border-b border-border pb-4 last:border-b-0 last:pb-0">
              <p className="text-[15px] leading-8 text-ink whitespace-pre-wrap"><span className="mr-1.5 font-bold text-brass">{verse.number}.</span>{verse.text}</p>
            </article>
          ))}
        </div>
        <ScrollEdge position="bottom" className="text-brass mt-4" />
      </div>

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
      {!isSundayRest && <div className="card relative isolate overflow-hidden border-border bg-surface-2 p-5 animate-slide-up">
        <PanelImageBackdrop
          image={meditationImage}
          opacityFallback={100}
          veilClassName=""
          modeFilter={false}
          textGradient={false}
        />
        <div className="panel-veil-layer award-panel-veil pointer-events-none absolute" aria-hidden="true" />
        <div className="relative z-10">
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
          <AppSelect
            value={bestVerse}
            onChange={(next) => { setBestVerse(next); setSavedMeditation(false); }}
            placeholder="Select a verse from today's reading"
            options={[
              ...(bestVerse && !verseChoices.some((choice) => choice.value === bestVerse) ? [{ value: bestVerse, label: bestVerse }] : []),
              ...verseChoices.map((choice) => ({ value: choice.value, label: choice.label })),
            ]}
          />
          </div>

          {/* Daily Meditation (50-100 words) */}
          <div className="mb-4">
          <label className="text-sm font-medium text-ink mb-1.5 block">Daily Meditation</label>
          <p className="text-xs text-stone mb-2">At least 50 words</p>
          <textarea
            value={meditation}
            onChange={(e) => { setMeditation(e.target.value); setSavedMeditation(false); }}
            className="input-field min-h-[120px] resize-y"
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
            className="input-field"
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
            className="btn-primary px-3 text-xs disabled:opacity-50 sm:px-5 sm:text-sm"
            title="Submit meditation"
          >
            <Save size={16} strokeWidth={1.5} /> <span className="hidden sm:inline">{saving ? 'Saving…' : 'Submit Meditation'}</span>
          </button>
          </div>
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

      <section className="card p-5 animate-slide-up bg-surface border-border">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="eyebrow text-stone">Reading Archive</p>
            <p className="mt-1 text-sm text-ink">Previous readings and your personal meditations</p>
          </div>
          <button type="button" className="btn-secondary text-xs" onClick={() => {
            const next = !showHistory;
            setShowHistory(next);
            if (next) void loadHistory();
          }}>
            <BookOpen size={14} /> {showHistory ? 'Hide' : 'Previous Readings'}
          </button>
        </div>
        {showHistory && (
          <div className="mt-4 space-y-3">
            {historyLoading && <p className="text-xs text-stone">Loading your reading archive...</p>}
            {!historyLoading && readingHistory.length === 0 && <p className="text-xs text-stone">No previous readings are available yet.</p>}
            {readingHistory.map((item) => (
              <details key={item.id} className="rounded-lg border border-border bg-surface-2 p-3">
                <summary className="cursor-pointer list-none">
                  <p className="text-sm font-semibold text-ink">{item.title}</p>
                  <p className="mt-0.5 text-xs text-stone">{item.narrative_date} · {item.scripture_reference}</p>
                </summary>
                <div className="mt-3 space-y-3 border-t border-border pt-3">
                  <p className="text-sm leading-relaxed text-ink whitespace-pre-wrap">{item.main_text}</p>
                  {(item.highlighted_verses || []).length > 0 && <div className="space-y-2">{item.highlighted_verses!.map((verse, index) => <div key={`${item.id}-${index}`} className="rounded-md bg-surface p-2"><p className="text-xs font-semibold text-brass">{verse.reference}</p><p className="mt-1 text-xs text-ink">{verse.text}</p>{verse.meditation && <p className="mt-1 text-xs text-stone">Instructor note: {verse.meditation}</p>}</div>)}</div>}
                  {item.meditation_text ? (
                    <div className="rounded-md border border-brass/20 bg-brass-soft p-3">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-brass">Your meditation</p>
                      {item.best_verse && <p className="mt-1 text-xs text-stone">Best verse: {item.best_verse}</p>}
                      <p className="mt-2 text-sm leading-relaxed text-ink whitespace-pre-wrap">{item.meditation_text}</p>
                      {item.daily_quote && <p className="mt-2 text-xs italic text-stone">&ldquo;{item.daily_quote}&rdquo;</p>}
                    </div>
                  ) : <p className="text-xs text-stone">You did not submit a meditation for this reading.</p>}
                </div>
              </details>
            ))}
          </div>
        )}
      </section>

      {/* ── Challenge — format-aware + reject/resubmit flow ── */}
      {!isSundayRest && narrative.challenge_active && narrative.challenge_title && (
        <div className="card relative isolate overflow-hidden border-border bg-surface-2 p-5 animate-slide-up">
          <PanelImageBackdrop
            image={challengeImage}
            opacityFallback={100}
            veilClassName=""
            modeFilter={false}
            textGradient={false}
          />
          <div className="panel-veil-layer award-panel-veil pointer-events-none absolute" aria-hidden="true" />
          <div className="relative z-10">
            <div className="flex items-center justify-between gap-3 mb-1">
              <span className="eyebrow text-stone">Daily Challenge</span>
              <span className="badge badge-roman text-[10px]" title="Submitting evidence awards 1000 Denarii">+1000D</span>
            </div>
            <div className="flex items-center gap-2 mt-3 mb-2">
              <Target size={18} className="text-roman" strokeWidth={1.5} />
              <h3 className="font-display font-semibold text-ink text-lg">
                {narrative.challenge_title}
              </h3>
            </div>
            <p className="mb-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-stone">
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
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (file && profile) {
                          setUploadingEvidence(true);
                          try {
                            const uploaded = await uploadChallengeEvidence(profile.id, file);
                            setChallengeText(JSON.stringify({ items: [uploaded] }));
                          } catch (error: any) {
                            alert(error.message || 'Could not upload evidence.');
                          }
                          setUploadingEvidence(false);
                          setChallengeSaved(false);
                        }
                      }}
                    />
                  </label>
                  {challengeText && (
                    <p className="text-xs text-moss flex items-center gap-1 break-all">
                      <CheckCircle2 size={12} /> {uploadingEvidence ? 'Uploading evidence...' : 'Evidence ready'}
                    </p>
                  )}
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
                    Submit evidence to earn 1000 Denarii. Review still comes from your sentry or instructor.
                  </span>
                )}
                <button
                  onClick={saveChallenge}
                  disabled={(proofFormat === 'link' ? !challengeLink.trim() : !challengeText.trim()) || saving}
                  className="btn-secondary px-3 text-xs disabled:opacity-50 sm:px-5 sm:text-sm"
                  title={challengeRejected ? 'Resubmit challenge' : 'Submit challenge'}
                >
                  <Sparkles size={16} strokeWidth={1.5} /> <span className="hidden sm:inline">{saving ? 'Saving…' : challengeRejected ? 'Resubmit' : 'Submit Challenge'}</span>
                </button>
              </div>
            </>
            )}
          </div>
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
