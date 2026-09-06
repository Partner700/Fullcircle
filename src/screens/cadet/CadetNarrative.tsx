import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useSubscriptionAccess } from '../../context/SubscriptionAccessContext';
import { EmptyState } from '../../components/AppShell';
import { ScrollEdge, SealBullet } from '../../components/AncientMotifs';
import { PanelImageBackdrop } from '../../components/PanelImageBackdrop';
import { AppSelect } from '../../components/AppSelect';
import { MessageAvatar } from '../../components/TentMessenger';
import { Dove } from '../../components/Dove';
import { VallumAvatarBadge } from '../../components/VallumAvatarBadge';
import { RelativeTime } from '../../components/RelativeTime';
import { addVerseInsightComment, editVerseInsight, editVerseInsightComment, fetchCampMentionCandidates, fetchNarrative, fetchNarratives, fetchChallengeSubmission, fetchPanelImageSetting, fetchVerseInsights, recordExternalShare, recordSundayReadingOpen, saveVerseInsight, toggleVerseInsightReaction, uploadChallengeEvidence, upsertChallengeSubmission } from '../../lib/queries';
import { supabase } from '../../lib/supabase';
import { getDayType, getTodayISODate, getAppClock, cn } from '../../lib/utils';
import { MEDITATION_CUTOFF_HOUR, MEDITATION_CUTOFF_MINUTE } from '../../lib/constants';
import type { DailyNarrative, ChallengeSubmission, ChallengeProofFormat, PanelImageSetting, Profile } from '../../lib/types';
import type { CampMentionCandidate, VerseInsightReactionType } from '../../lib/queries';
import { clearScriptureTarget, readScriptureTarget, type ScriptureNavigationTarget } from '../../lib/scriptureNavigation';
import { emptyReadingDraft, readReadingDraft, readingDraftStorageKey, writeReadingDraft, type ReadingDraft, type ReadingReplyTarget } from '../../lib/readingDrafts';
import {
  fetchPendingHiddenVerseMarkers,
  readingVerseChallengeKey,
  revealHiddenChallenge,
  type HiddenVerseChallengeMarker,
} from '../../lib/hiddenChallenges';
import {
  BookOpen, BookMarked, Heart, Lightbulb, Target, CheckCircle2, Save, Sparkles,
  ScrollText, Sun, Link2, Image as ImageIcon,
  AlertCircle, RefreshCw, FileText,
  MessageCircle, Reply, Send, Pencil, Check, ArrowLeft, CalendarDays, ChevronRight,
  Lock, Share2,
} from 'lucide-react';

function splitScriptureVerses(text: string) {
  const compact = text.replace(/\r/g, '').replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
  const matches = Array.from(compact.matchAll(/(?:^|\s)(\d{1,3})[.)]?\s+(.+?)(?=(?:\s+\d{1,3}[.)]?\s+(?=[A-Z“\"]|$))|$)/g));
  if (matches.length >= 2) {
    return matches.map((match) => ({ number: match[1], text: match[2].trim() })).filter((verse) => verse.text);
  }
  return text.split(/\n{2,}/).filter(Boolean).map((paragraph, index) => ({ number: String(index + 1), text: paragraph.trim() }));
}

type ScriptureVerse = {
  reference: string;
  text: string;
  meditation: string;
  sourceNarrativeId?: string;
  sourceNarrativeDate?: string;
};

const INSIGHT_REACTIONS: { type: VerseInsightReactionType; label: string; icon: typeof Heart }[] = [
  { type: 'heart', label: 'Love this insight', icon: Heart },
  { type: 'lightbulb', label: 'This gave me an idea', icon: Lightbulb },
];

function messageProfile(userId: string, displayName: string, avatarUrl?: string | null): Profile {
  return {
    id: userId,
    display_name: displayName,
    email: null,
    avatar_url: avatarUrl || null,
    whatsapp_number: null,
    created_at: '',
  };
}

type InsightParticipantSource = {
  user_id: string;
  profiles?: { display_name?: string | null; avatar_url?: string | null } | null;
  comments?: Array<{
    user_id: string;
    profile?: { display_name?: string | null; avatar_url?: string | null } | null;
  }>;
  reactions?: Partial<Record<VerseInsightReactionType, {
    actors?: Array<{ user_id: string; display_name?: string | null; avatar_url?: string | null; is_guest?: boolean }>;
  }>>;
};

function insightParticipants(insights: InsightParticipantSource[]) {
  const participants = new Map<string, { userId: string; displayName: string; avatarUrl: string | null; isGuest: boolean }>();
  const addParticipant = (userId?: string | null, displayName?: string | null, avatarUrl?: string | null, isGuest = false) => {
    if (!userId) return;
    const existing = participants.get(userId);
    participants.set(userId, {
      userId,
      displayName: displayName || existing?.displayName || 'Reader',
      avatarUrl: avatarUrl || existing?.avatarUrl || null,
      isGuest: isGuest || existing?.isGuest || false,
    });
  };

  insights.forEach((insight) => {
    addParticipant(insight.user_id, insight.profiles?.display_name, insight.profiles?.avatar_url);
    (insight.comments || []).forEach((comment) => {
      addParticipant(comment.user_id, comment.profile?.display_name, comment.profile?.avatar_url);
    });
    INSIGHT_REACTIONS.forEach(({ type }) => {
      (insight.reactions?.[type]?.actors || []).forEach((actor) => {
        addParticipant(actor.user_id, actor.display_name, actor.avatar_url, actor.is_guest);
      });
    });
  });

  return Array.from(participants.values());
}

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
              <span className="relative flex h-8 w-8 flex-shrink-0 items-center justify-center text-xs font-bold text-peri">
                <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full border border-border bg-peri-soft">{candidate.avatar_url ? <img src={candidate.avatar_url} alt="" className="h-full w-full object-cover" /> : candidate.display_name.charAt(0)}</span>
                <VallumAvatarBadge userId={candidate.user_id} size="sm" />
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

function readingArchiveGroups<T extends { narrative_date: string }>(items: T[]) {
  const months = new Map<string, { key: string; label: string; weeks: Map<string, { key: string; label: string; items: T[] }> }>();
  items.forEach((item) => {
    const date = new Date(`${item.narrative_date}T12:00:00`);
    const monthKey = item.narrative_date.slice(0, 7);
    const month = months.get(monthKey) || {
      key: monthKey,
      label: date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      weeks: new Map(),
    };
    const monday = new Date(date);
    monday.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const weekKey = monday.toISOString().slice(0, 10);
    const week = month.weeks.get(weekKey) || {
      key: weekKey,
      label: `${monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${sunday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
      items: [],
    };
    week.items.push(item);
    month.weeks.set(weekKey, week);
    months.set(monthKey, month);
  });
  return Array.from(months.values()).map((month) => ({
    ...month,
    weeks: Array.from(month.weeks.values()),
  }));
}

type ArchivedReading = DailyNarrative & {
  meditation_text: string | null;
  best_verse: string | null;
  daily_quote: string | null;
};

function ReadingArchiveBrowser({
  open,
  loading,
  readings,
  onToggle,
  onOpenReading,
}: {
  open: boolean;
  loading: boolean;
  readings: ArchivedReading[];
  onToggle: () => void;
  onOpenReading: (date: string) => void;
}) {
  const groups = useMemo(() => readingArchiveGroups(readings), [readings]);
  return (
    <section className="card p-5 animate-slide-up bg-surface border-border">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="eyebrow text-stone">Reading Archive</p>
          <p className="mt-1 text-sm text-ink">Full readings and conversations, grouped by month and week</p>
        </div>
        <button type="button" className="btn-secondary flex-shrink-0 text-xs" onClick={onToggle}>
          <BookOpen size={14} /> {open ? 'Hide' : 'Previous Readings'}
        </button>
      </div>
      {open && (
        <div className="mt-4 space-y-5">
          {loading && <p className="text-xs text-stone">Loading your reading archive...</p>}
          {!loading && readings.length === 0 && <p className="text-xs text-stone">No previous readings are available yet.</p>}
          {groups.map((month) => (
            <section key={month.key} className="space-y-3">
              <div className="flex items-center gap-2 border-b border-border pb-2">
                <CalendarDays size={15} className="text-brass" />
                <h3 className="font-display text-sm font-bold text-ink">{month.label}</h3>
              </div>
              {month.weeks.map((week) => (
                <div key={week.key} className="space-y-2">
                  <p className="text-[10px] font-bold uppercase text-stone">Week of {week.label}</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {week.items.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className="group flex min-w-0 items-center gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-left transition-colors hover:border-brass/45 hover:bg-brass-soft"
                        onClick={() => onOpenReading(item.narrative_date)}
                      >
                        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-brass/25 bg-brass-soft text-xs font-bold text-brass">
                          {new Date(`${item.narrative_date}T12:00:00`).getDate()}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-bold text-ink">{item.title}</span>
                          <span className="mt-0.5 block truncate text-[10px] text-stone">{item.scripture_reference}</span>
                          {item.meditation_text && <span className="mt-1 block text-[9px] font-bold uppercase text-moss">Meditation saved</span>}
                        </span>
                        <ChevronRight size={15} className="flex-shrink-0 text-stone transition-transform group-hover:translate-x-0.5 group-hover:text-brass" />
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

export function CadetNarrative({
  onMeditationSaved,
  streakCount = 0,
}: {
  onMeditationSaved?: () => Promise<void> | void;
  streakCount?: number;
}) {
  const { profile } = useAuth();
  const { hasAccess, requireSubscription } = useSubscriptionAccess();
  const [narrative, setNarrative] = useState<DailyNarrative | null>(null);
  const [loading, setLoading] = useState(true);
  const [meditation, setMeditation] = useState('');
  const [bestVerse, setBestVerse] = useState('');
  const [dailyQuote, setDailyQuote] = useState('');
  const [savedMeditation, setSavedMeditation] = useState(false);
  const [meditationPublic, setMeditationPublic] = useState(false);
  const [challenge, setChallenge] = useState<ChallengeSubmission | null>(null);
  const [challengeText, setChallengeText] = useState('');
  const [challengeLink, setChallengeLink] = useState('');
  const [challengeSaved, setChallengeSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [readingImage, setReadingImage] = useState<PanelImageSetting | null>(null);
  const [scriptureImage, setScriptureImage] = useState<PanelImageSetting | null>(null);
  const [challengeImage, setChallengeImage] = useState<PanelImageSetting | null>(null);
  const [meditationImage, setMeditationImage] = useState<PanelImageSetting | null>(null);
  const [openVerse, setOpenVerse] = useState<number | null>(null);
  const [readerVerses, setReaderVerses] = useState<ScriptureVerse[]>([]);
  const [verseInsights, setVerseInsights] = useState<any[]>([]);
  const [hiddenVerseMarkers, setHiddenVerseMarkers] = useState<HiddenVerseChallengeMarker[]>([]);
  const [openUserInsights, setOpenUserInsights] = useState<string | null>(null);
  const [closedSundayInsights, setClosedSundayInsights] = useState<string[]>([]);
  const [myInsightDrafts, setMyInsightDrafts] = useState<Record<string, string>>({});
  const [savingInsight, setSavingInsight] = useState<string | null>(null);
  const [openInsightReplies, setOpenInsightReplies] = useState<string | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [replyTargets, setReplyTargets] = useState<Record<string, ReadingReplyTarget | null>>({});
  const [savingReply, setSavingReply] = useState<string | null>(null);
  const [editingInsightId, setEditingInsightId] = useState<string | null>(null);
  const [editingInsightBody, setEditingInsightBody] = useState('');
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentBody, setEditingCommentBody] = useState('');
  const [reactionPendingKey, setReactionPendingKey] = useState<string | null>(null);
  const [campMentionCandidates, setCampMentionCandidates] = useState<CampMentionCandidate[]>([]);
  const [uploadingEvidence, setUploadingEvidence] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [readingHistory, setReadingHistory] = useState<ArchivedReading[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [archiveDate, setArchiveDate] = useState<string | null>(null);
  const [navigationTarget, setNavigationTarget] = useState<ScriptureNavigationTarget | null>(() => readScriptureTarget());
  const verseRefs = useRef<Record<string, HTMLElement | null>>({});
  const draftHydratedKeyRef = useRef<string | null>(null);
  const draftSnapshotRef = useRef<ReadingDraft>(emptyReadingDraft());

  const today = getTodayISODate();
  const activeDate = archiveDate || today;
  const isHistoricalReading = activeDate < today;
  const dayType = getDayType(new Date(`${activeDate}T12:00:00`));
  const isSundayRest = dayType === 'sunday';
  const draftStorageKey = profile ? readingDraftStorageKey(profile.id, activeDate) : null;

  useEffect(() => {
    if (!profile || !narrative || isHistoricalReading) return;
    revealHiddenChallenge({ placement: 'todays_reading', referenceKey: narrative.id });
  }, [isHistoricalReading, narrative, profile]);
  const draftSnapshot = useMemo<ReadingDraft>(() => ({
    meditation: savedMeditation ? '' : meditation,
    bestVerse: savedMeditation ? '' : bestVerse,
    dailyQuote: savedMeditation ? '' : dailyQuote,
    challengeText: challengeSaved || (challenge && challenge.status !== 'rejected') ? '' : challengeText,
    challengeLink: challengeSaved || (challenge && challenge.status !== 'rejected') ? '' : challengeLink,
    insightDrafts: myInsightDrafts,
    replyDrafts,
    replyTargets,
    openUserInsights,
    openInsightReplies,
    editingInsightId,
    editingInsightBody,
    editingCommentId,
    editingCommentBody,
  }), [
    bestVerse,
    challenge,
    challengeLink,
    challengeSaved,
    challengeText,
    dailyQuote,
    editingCommentBody,
    editingCommentId,
    editingInsightBody,
    editingInsightId,
    meditation,
    myInsightDrafts,
    openInsightReplies,
    openUserInsights,
    replyDrafts,
    replyTargets,
    savedMeditation,
  ]);
  draftSnapshotRef.current = draftSnapshot;
  const conversationNarrativeIds = useMemo(() => {
    const sourceIds = (narrative?.scripture_passages || [])
      .map((passage) => passage.source_narrative_id)
      .filter((value): value is string => Boolean(value));
    if (sourceIds.length) return Array.from(new Set(sourceIds));
    return narrative?.id ? [narrative.id] : [];
  }, [narrative]);

  const reloadVerseInsights = useCallback(async () => {
    if (!conversationNarrativeIds.length) {
      setVerseInsights([]);
      return [];
    }
    const items = await fetchVerseInsights(conversationNarrativeIds, profile?.id);
    setVerseInsights(items);
    return items;
  }, [conversationNarrativeIds, profile?.id]);

  const reloadHiddenVerseMarkers = useCallback(async () => {
    if (!profile?.id || !conversationNarrativeIds.length) {
      setHiddenVerseMarkers([]);
      return [];
    }
    const markers = await fetchPendingHiddenVerseMarkers(conversationNarrativeIds);
    setHiddenVerseMarkers(markers);
    return markers;
  }, [conversationNarrativeIds, profile?.id]);

  const openHiddenVerseChallenge = useCallback((narrativeId: string, verseReference: string) => {
    const referenceKey = readingVerseChallengeKey(narrativeId, verseReference);
    setHiddenVerseMarkers((current) => current.filter((marker) => marker.reference_key !== referenceKey));
    revealHiddenChallenge({ placement: 'verse', referenceKey });
  }, []);

  const shareReading = async () => {
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('share', 'reading');
    url.searchParams.set('date', activeDate);
    const shareData = {
      title: narrative?.title || 'Full Circle Daily Reading',
      text: narrative?.scripture_reference || 'Read today\'s scripture with Full Circle.',
      url: url.toString(),
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(shareData.url);
        alert('Reading link copied.');
      }
      await recordExternalShare('reading', activeDate).catch(() => undefined);
    } catch (error: any) {
      if (error?.name !== 'AbortError') alert('Could not share this reading.');
    }
  };

  const load = useCallback(async () => {
    if (!profile) { setLoading(false); return; }
    const expectedDraftKey = readingDraftStorageKey(profile.id, activeDate);
    const localDraft = readReadingDraft(profile.id, activeDate);
    draftHydratedKeyRef.current = null;
    setLoading(true);
    setReaderVerses([]);
    setVerseInsights([]);
    setOpenVerse(null);
    setMeditation(localDraft.meditation);
    setBestVerse(localDraft.bestVerse);
    setDailyQuote(localDraft.dailyQuote);
    setSavedMeditation(false);
    setChallengeText(localDraft.challengeText);
    setChallengeLink(localDraft.challengeLink);
    setChallengeSaved(false);
    setMyInsightDrafts(localDraft.insightDrafts);
    setReplyDrafts(localDraft.replyDrafts);
    setReplyTargets(localDraft.replyTargets);
    setOpenUserInsights(localDraft.openUserInsights);
    setOpenInsightReplies(localDraft.openInsightReplies);
    setEditingInsightId(localDraft.editingInsightId);
    setEditingInsightBody(localDraft.editingInsightBody);
    setEditingCommentId(localDraft.editingCommentId);
    setEditingCommentBody(localDraft.editingCommentBody);
    try {
      const [narr, chal, panelImage, scripturePanelImage, legacyVersePanelImage, challengePanelImage, meditationPanelImage] = await Promise.all([
        fetchNarrative(activeDate),
        isHistoricalReading ? Promise.resolve(null) : fetchChallengeSubmission(profile.id, activeDate),
        fetchPanelImageSetting('reading').catch(() => null),
        fetchPanelImageSetting('scripture').catch(() => null),
        fetchPanelImageSetting('verse_day_tr').catch(() => null),
        fetchPanelImageSetting('challenge').catch(() => null),
        fetchPanelImageSetting('meditation').catch(() => null),
      ]);
      setNarrative(narr);
      setChallenge(chal);
      setReadingImage(panelImage);
      setScriptureImage(scripturePanelImage || legacyVersePanelImage);
      setChallengeImage(challengePanelImage);
      setMeditationImage(meditationPanelImage);
      if (chal?.proof_text) {
        if (narr?.challenge_proof_format === 'link') setChallengeLink(chal.proof_text);
        else setChallengeText(chal.proof_text);
      }

      const { data: record } = await supabase
        .from('daily_records')
        .select('meditation_text, meditation_submitted, meditation_public, best_verse, daily_quote')
        .eq('user_id', profile.id)
        .eq('record_date', activeDate)
        .maybeSingle();
      if (record?.meditation_text) setMeditation(record.meditation_text);
      if (record?.best_verse) setBestVerse(record.best_verse);
      if (record?.daily_quote) setDailyQuote(record.daily_quote);
      setMeditationPublic(Boolean(record?.meditation_public));
      setSavedMeditation(Boolean(record?.meditation_submitted));
    } catch (e) { console.error('Narrative load error:', e); }
    draftHydratedKeyRef.current = expectedDraftKey;
    setLoading(false);
  }, [activeDate, isHistoricalReading, profile]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!profile || !draftStorageKey || draftHydratedKeyRef.current !== draftStorageKey) return;
    writeReadingDraft(profile.id, activeDate, draftSnapshot);
  }, [activeDate, draftSnapshot, draftStorageKey, profile]);

  const flushReadingDraft = useCallback(() => {
    if (!profile || !draftStorageKey || draftHydratedKeyRef.current !== draftStorageKey) return;
    writeReadingDraft(profile.id, activeDate, draftSnapshotRef.current);
  }, [activeDate, draftStorageKey, profile]);

  useEffect(() => {
    const persistWhenHidden = () => {
      if (document.visibilityState === 'hidden') flushReadingDraft();
    };
    window.addEventListener('pagehide', flushReadingDraft);
    document.addEventListener('visibilitychange', persistWhenHidden);
    return () => {
      flushReadingDraft();
      window.removeEventListener('pagehide', flushReadingDraft);
      document.removeEventListener('visibilitychange', persistWhenHidden);
    };
  }, [flushReadingDraft]);

  useEffect(() => {
    setClosedSundayInsights([]);
  }, [activeDate]);

  useEffect(() => {
    let cancelled = false;
    fetchCampMentionCandidates()
      .then((candidates) => { if (!cancelled) setCampMentionCandidates(candidates); })
      .catch(() => { if (!cancelled) setCampMentionCandidates([]); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!profile || !hasAccess || !isSundayRest || isHistoricalReading) return;
    let cancelled = false;
    const creditSundayReading = async () => {
      try {
        const credited = await recordSundayReadingOpen(profile.id, activeDate);
        if (credited && !cancelled) await onMeditationSaved?.();
      } catch (error) {
        console.error('Sunday reading streak credit failed:', error);
      }
    };
    void creditSundayReading();
    return () => { cancelled = true; };
  }, [activeDate, hasAccess, isHistoricalReading, isSundayRest, onMeditationSaved, profile]);

  const loadHistory = async () => {
    if (!profile || historyLoading) return;
    setHistoryLoading(true);
    try {
      const [pastNarratives, recordsResult] = await Promise.all([
        fetchNarratives(370),
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
    const passages = narrative.scripture_passages?.length
      ? narrative.scripture_passages
      : [{
        reference: narrative.scripture_reference,
        translation: narrative.translation,
        main_text: narrative.main_text,
        highlighted_verses: narrative.highlighted_verses || [],
      }];
    const savedVerses = passages.flatMap((passage) => (passage.highlighted_verses || []).map((verse) => ({
      ...verse,
      sourceNarrativeId: verse.source_narrative_id || passage.source_narrative_id || narrative.id,
      sourceNarrativeDate: verse.source_narrative_date || passage.source_narrative_date || narrative.narrative_date,
    })));
    setReaderVerses(savedVerses);
    if (savedVerses.length > 1 || passages.length > 1) {
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
          return {
            reference,
            text: String(verse.text || '').trim(),
            meditation: notesByReference.get(reference) || '',
            sourceNarrativeId: narrative.id,
            sourceNarrativeDate: narrative.narrative_date,
          };
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
    if (!conversationNarrativeIds.length) return;
    let cancelled = false;
    fetchVerseInsights(conversationNarrativeIds, profile?.id).then((items) => {
      if (!cancelled) {
        setVerseInsights(items);
      }
    });
    return () => { cancelled = true; };
  }, [conversationNarrativeIds, profile?.id]);

  useEffect(() => {
    if (!profile?.id || !conversationNarrativeIds.length) {
      setHiddenVerseMarkers([]);
      return;
    }

    void reloadHiddenVerseMarkers().catch(() => undefined);
    const channel = supabase
      .channel(`hidden_verse_markers_${profile.id}_${conversationNarrativeIds.join('_')}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'user_notifications', filter: `recipient_id=eq.${profile.id}` },
        (payload) => {
          const notification = payload.new as { metadata?: Record<string, unknown> };
          if (notification.metadata?.placement === 'verse') {
            void reloadHiddenVerseMarkers().catch(() => undefined);
          }
        },
      )
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [conversationNarrativeIds, profile?.id, reloadHiddenVerseMarkers]);

  useEffect(() => {
    if (!narrative?.id || !profile?.id || !conversationNarrativeIds.length) return;
    let refreshTimer: number | null = null;

    const refreshInsights = () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        void reloadVerseInsights();
      }, 120);
    };

    const channel = supabase.channel(`reading_insights_${narrative.id}_${conversationNarrativeIds.length}`);
    conversationNarrativeIds.forEach((narrativeId) => {
      channel.on('postgres_changes', { event: '*', schema: 'public', table: 'scripture_verse_insights', filter: `narrative_id=eq.${narrativeId}` }, refreshInsights);
    });
    channel
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scripture_insight_comments' }, refreshInsights)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scripture_insight_reactions' }, refreshInsights)
      .subscribe();

    return () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      void supabase.removeChannel(channel);
    };
  }, [conversationNarrativeIds, narrative?.id, profile?.id, reloadVerseInsights]);

  useEffect(() => {
    const receiveTarget = (event: Event) => setNavigationTarget((event as CustomEvent<ScriptureNavigationTarget>).detail);
    window.addEventListener('full-circle-open-scripture', receiveTarget);
    return () => window.removeEventListener('full-circle-open-scripture', receiveTarget);
  }, []);

  useEffect(() => {
    if (!navigationTarget?.narrativeId || navigationTarget.narrativeId === narrative?.id) return;
    let cancelled = false;
    void supabase
      .from('daily_narratives')
      .select('narrative_date')
      .eq('id', navigationTarget.narrativeId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled && data?.narrative_date) setArchiveDate(data.narrative_date);
      });
    return () => { cancelled = true; };
  }, [navigationTarget?.narrativeId, narrative?.id]);

  useEffect(() => {
    if (!navigationTarget || !narrative?.id || readerVerses.length === 0) return;
    if (navigationTarget.narrativeId && navigationTarget.narrativeId !== narrative.id) return;
    const targetedInsight = navigationTarget.insightId
      ? verseInsights.find((item: any) => item.id === navigationTarget.insightId)
      : null;
    const reference = navigationTarget.verseReference || targetedInsight?.verse_reference;
    if (!reference) return;
    const index = readerVerses.findIndex((verse) => verse.reference.toLowerCase() === reference.toLowerCase());
    if (index < 0) return;
    const targetSourceNarrativeId = readerVerses[index].sourceNarrativeId || narrative.id;
    setOpenVerse(index);
    setOpenUserInsights(reference);
    setClosedSundayInsights((current) => current.filter((key) => key !== `${targetSourceNarrativeId}:${reference}`));
    openHiddenVerseChallenge(targetSourceNarrativeId, reference);
    window.setTimeout(() => verseRefs.current[reference]?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120);
    clearScriptureTarget();
    setNavigationTarget(null);
  }, [navigationTarget, narrative?.id, openHiddenVerseChallenge, readerVerses, verseInsights]);

  const meditationWordCount = meditation.trim() ? meditation.trim().split(/\s+/).length : 0;
  const quoteWordCount = dailyQuote.trim() ? dailyQuote.trim().split(/\s+/).length : 0;
  const appClock = getAppClock();
  const afterMeditationCutoff =
    appClock.hour > MEDITATION_CUTOFF_HOUR ||
    (appClock.hour === MEDITATION_CUTOFF_HOUR && appClock.minute >= MEDITATION_CUTOFF_MINUTE);
  const canSubmitMeditation =
    hasAccess &&
    !isHistoricalReading &&
    !afterMeditationCutoff &&
    bestVerse.trim().length > 0 &&
    meditationWordCount >= 50 &&
    quoteWordCount > 0 &&
    quoteWordCount <= 10;

  const saveMeditation = async () => {
    if (!requireSubscription()) return;
    if (!profile || isHistoricalReading || !canSubmitMeditation) return;
    setSaving(true);
    const { error } = await supabase.rpc('submit_daily_meditation', {
      p_record_date: activeDate,
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

  const changeMeditationVisibility = async (next: boolean) => {
    if (!profile || !savedMeditation) return;
    const { error } = await supabase.rpc('set_daily_meditation_public', { p_record_date: activeDate, p_public: next });
    if (error) { alert(error.message || 'Meditation visibility could not be changed.'); return; }
    setMeditationPublic(next);
  };

  const saveChallenge = async () => {
    if (!requireSubscription()) return;
    if (!profile || isHistoricalReading) return;
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
      narrative_date: activeDate,
      proof_text: proof,
      proof_type: format,
      status: 'pending',
      submitted_at: new Date().toISOString(),
    });
    setChallengeSaved(true);
    setSaving(false);
    load();
  };

  const submitVerseInsight = async (reference: string, sourceNarrativeId?: string) => {
    if (!requireSubscription()) return;
    if (!profile || !narrative?.id) return;
    const body = (myInsightDrafts[reference] || '').trim();
    if (!body) return;
    setSavingInsight(reference);
    try {
      await saveVerseInsight(sourceNarrativeId || narrative.id, profile.id, reference, body, mentionedUserIds(body, campMentionCandidates));
      await reloadVerseInsights();
      setOpenUserInsights(reference);
      setMyInsightDrafts((current) => ({ ...current, [reference]: '' }));
    } catch (error: any) {
      alert(error.message || 'Could not save your insight.');
    }
    setSavingInsight(null);
  };

  const submitInsightReply = async (insight: any) => {
    if (!requireSubscription()) return;
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
      await reloadVerseInsights();
      setReplyDrafts((current) => ({ ...current, [insight.id]: '' }));
      setReplyTargets((current) => ({ ...current, [insight.id]: null }));
      setOpenInsightReplies(insight.id);
    } catch (error: any) {
      alert(error.message || 'Could not post your reply.');
    }
    setSavingReply(null);
  };

  const submitInsightEdit = async () => {
    if (!requireSubscription()) return;
    if (!editingInsightId || !editingInsightBody.trim() || !narrative?.id) return;
    try {
      await editVerseInsight(editingInsightId, editingInsightBody.trim());
      setEditingInsightId(null);
      setEditingInsightBody('');
      await reloadVerseInsights();
    } catch (error: any) { alert(error.message || 'Could not edit your insight.'); }
  };

  const submitInsightCommentEdit = async () => {
    if (!requireSubscription()) return;
    if (!editingCommentId || !editingCommentBody.trim() || !narrative?.id) return;
    try {
      await editVerseInsightComment(editingCommentId, editingCommentBody.trim());
      setEditingCommentId(null);
      setEditingCommentBody('');
      await reloadVerseInsights();
    } catch (error: any) { alert(error.message || 'Could not edit your reply.'); }
  };

  const reactToInsight = async (insightId: string, reactionType: VerseInsightReactionType) => {
    if (!profile || reactionPendingKey) return;
    const pendingKey = `${insightId}:${reactionType}`;
    const insight = verseInsights.find((item: any) => item.id === insightId);
    const previous = insight?.reactions?.[reactionType] || { count: 0, reacted: false };
    const nextReacted = !previous.reacted;

    setReactionPendingKey(pendingKey);
    setVerseInsights((current) => current.map((item: any) => item.id === insightId ? {
      ...item,
      reactions: {
        ...item.reactions,
        [reactionType]: {
          count: Math.max(0, Number(previous.count || 0) + (nextReacted ? 1 : -1)),
          reacted: nextReacted,
          actors: nextReacted
            ? [
                { user_id: profile.id, display_name: profile.display_name, avatar_url: profile.avatar_url || null },
                ...(previous.actors || []).filter((actor: any) => actor.user_id !== profile.id),
              ]
            : (previous.actors || []).filter((actor: any) => actor.user_id !== profile.id),
        },
      },
    } : item));

    try {
      await toggleVerseInsightReaction(insightId, reactionType);
      if (narrative?.id) await reloadVerseInsights();
    } catch (error: any) {
      setVerseInsights((current) => current.map((item: any) => item.id === insightId ? {
        ...item,
        reactions: { ...item.reactions, [reactionType]: previous },
      } : item));
      alert(error.message || 'Could not save your reaction.');
    } finally {
      setReactionPendingKey(null);
    }
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
      <div className="space-y-5 max-w-3xl mx-auto">
        <EmptyState icon={BookOpen} title="No reading published" message="This date has no published reading. Your previous readings remain available below." />
        {isHistoricalReading && (
          <button type="button" className="btn-secondary text-xs" onClick={() => setArchiveDate(null)}>
            <ArrowLeft size={14} /> Return to Today
          </button>
        )}
        <ReadingArchiveBrowser
          open={showHistory}
          loading={historyLoading}
          readings={readingHistory}
          onToggle={() => { const next = !showHistory; setShowHistory(next); if (next) void loadHistory(); }}
          onOpenReading={(date) => { setArchiveDate(date); setShowHistory(false); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
        />
      </div>
    );
  }

  const challengeRejected = challenge?.status === 'rejected';
  const challengeApproved = challenge?.status === 'approved';
  const proofFormat: ChallengeProofFormat = (narrative.challenge_proof_format as ChallengeProofFormat) || 'text';
  const displayVerses: ScriptureVerse[] = readerVerses.length ? readerVerses : (narrative.highlighted_verses || []).map((verse) => ({
    ...verse,
    sourceNarrativeId: verse.source_narrative_id || narrative.id,
    sourceNarrativeDate: verse.source_narrative_date || narrative.narrative_date,
  }));
  const verseChoices = displayVerses.map((verse) => ({ value: verse.reference, label: verse.reference }));
  const fetchedVerses = splitScriptureVerses(narrative.main_text || '');

  return (
    <div className="today-reading-screen space-y-5 animate-fade-in max-w-3xl mx-auto">
      {isHistoricalReading && (
        <div className="card flex items-center justify-between gap-3 border-brass/30 bg-brass-soft px-4 py-3">
          <div className="min-w-0">
            <p className="eyebrow text-brass">Previous Reading</p>
            <p className="mt-0.5 truncate text-xs text-ink">
              {new Date(`${activeDate}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
            </p>
          </div>
          <button type="button" className="btn-secondary flex-shrink-0 text-xs" onClick={() => { setArchiveDate(null); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
            <ArrowLeft size={14} /> Today
          </button>
        </div>
      )}
      {/* ── Header card — scripture reference + theme ── */}
      <div
        className="card relative overflow-hidden p-4 sm:p-5 animate-slide-up border-border backdrop-blur-sm"
        style={{ background: 'color-mix(in srgb, var(--color-navy-3) 42%, transparent)', backdropFilter: 'blur(18px) saturate(1.18)' }}
      >
        <PanelImageBackdrop image={readingImage} opacityOverride={58} veilClassName="" />
        <div className="relative">
          {!isSundayRest && (
            <div className="eyebrow text-brass flex items-center gap-2 mb-2">
              <BookMarked size={14} strokeWidth={1.5} />
              {narrative.scripture_reference} · {narrative.translation}
            </div>
          )}
          <div className="flex items-start justify-between gap-3">
            <h2 className="font-display text-2xl font-semibold text-ink leading-tight">
              {narrative.title}
            </h2>
            <button type="button" className="icon-btn shrink-0" aria-label="Share this reading" title="Share this reading" onClick={() => void shareReading()}>
              <Share2 size={16} />
            </button>
          </div>
          <p className="text-sm text-stone mt-1.5">{narrative.theme}</p>
          {!isSundayRest && (narrative.scripture_passages?.length || 0) > 1 && (
            <p className="mt-2 text-[11px] font-semibold text-brass">
              Also reading: {narrative.scripture_passages!.slice(1).map((passage) => passage.reference).join(' · ')}
            </p>
          )}
        </div>
      </div>

      {narrative.verse_of_day && (
        <div
          className={cn(
            'card reading-glass-panel relative overflow-hidden animate-slide-up border-brass/30',
            isSundayRest ? 'max-h-[60svh] p-4' : 'p-5',
          )}
          style={{
            backdropFilter: 'blur(26px) saturate(1.22)',
          }}
        >
          <PanelImageBackdrop image={scriptureImage} opacityFallback={100} imageClassName="quote-glass-image" veilClassName="quote-picture-veil" modeFilter={false} textGradient={false} simple />
          <div className="relative z-10">
          <div className={cn('flex items-center gap-2', isSundayRest ? 'mb-2' : 'mb-3')}>
            <Sun size={18} className="text-brass" strokeWidth={1.5} />
            <span className="eyebrow text-stone">{isSundayRest ? 'Verse of the Week' : 'Verse of the Day'}</span>
          </div>
          <ScrollEdge position="top" className={cn('text-brass', isSundayRest ? 'mb-2' : 'mb-3')} />
          <p className={cn(
            'font-display text-ink',
            isSundayRest ? 'max-h-[calc(60svh-7.5rem)] overflow-y-auto pr-1 text-base leading-relaxed sm:text-lg' : 'text-xl leading-snug',
          )}>
            &ldquo;{narrative.verse_of_day}&rdquo;
          </p>
          <ScrollEdge position="bottom" className={cn('text-brass', isSundayRest ? 'mt-2' : 'mt-3')} />
          </div>
        </div>
      )}

      {/* ── Scripture text ── */}
      <div
        className="card reading-glass-panel relative isolate overflow-hidden p-5 animate-slide-up border-border"
        style={{
          backdropFilter: 'blur(26px) saturate(1.22)',
        }}
      >
        <PanelImageBackdrop image={scriptureImage} opacityFallback={100} imageClassName="quote-glass-image" veilClassName="quote-picture-veil" modeFilter={false} textGradient={false} simple />
        <div className="relative z-10">
        <div className="flex items-center gap-2 mb-3">
          <ScrollText size={18} className="text-brass" strokeWidth={1.5} />
          <span className="eyebrow text-stone">Scripture</span>
        </div>
        <ScrollEdge position="top" className="text-brass mb-4" />
        <div className="space-y-4 sm:space-y-5">
          {displayVerses.length ? displayVerses.map((verse, index) => {
            const sourceNarrativeId = verse.sourceNarrativeId || narrative.id;
            const userInsights = verseInsights.filter((item: any) => (
              item.narrative_id === sourceNarrativeId && item.verse_reference === verse.reference
            ));
            const hasInsight = Boolean(verse.meditation?.trim());
            const hasReaderInsight = userInsights.length > 0;
            const participants = insightParticipants(userInsights);
            const sharedByMe = userInsights.some((item: any) => item.user_id === profile?.id);
            const verseReferenceKey = readingVerseChallengeKey(sourceNarrativeId, verse.reference);
            const hiddenVerseMarker = hiddenVerseMarkers.find((marker) => marker.reference_key === verseReferenceKey);
            const taggedMe = Boolean(hiddenVerseMarker) || userInsights.some((item: any) =>
              (item.mentioned_user_ids || []).includes(profile?.id)
              || (item.comments || []).some((comment: any) =>
                comment.mentioned_user_id === profile?.id || (comment.mentioned_user_ids || []).includes(profile?.id),
              ),
            );
            const expanded = isSundayRest || openVerse === index;
            const sundayInsightKey = `${sourceNarrativeId}:${verse.reference}`;
            const userExpanded = isSundayRest
              ? !closedSundayInsights.includes(sundayInsightKey)
              : openUserInsights === verse.reference;
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
                  onClick={() => !isSundayRest && hasInsight && setOpenVerse(expanded ? null : index)}
                  className={cn('w-full px-1 py-1 text-left transition-colors', !isSundayRest && hasInsight ? 'hover:bg-peri-soft cursor-pointer' : 'cursor-default')}
                  aria-expanded={hasInsight ? expanded : undefined}
                >
                  <p className="text-[15px] leading-8 text-ink"><span className="mr-1.5 font-bold text-brass">{verseNumber}.</span>{verse.text}</p>
                  <span className="mt-2 block text-[10px] font-bold uppercase tracking-widest text-brass">
                    {verse.reference}{hiddenVerseMarker ? ' · Tagged for you' : ''}{hasInsight ? ' · Instructor annotation available' : ''}{userInsights.length ? ` · ${userInsights.length} reader insight${userInsights.length === 1 ? '' : 's'}` : ''}
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
                    <button type="button" className="btn-ghost px-2 py-1 text-[10px]" onClick={() => {
                      if (isSundayRest) {
                        if (userExpanded) {
                          setClosedSundayInsights((current) => current.includes(sundayInsightKey) ? current : [...current, sundayInsightKey]);
                          return;
                        }
                        if (!userExpanded && userInsights.length === 0 && !requireSubscription()) return;
                        setClosedSundayInsights((current) => current.filter((key) => key !== sundayInsightKey));
                        openHiddenVerseChallenge(sourceNarrativeId, verse.reference);
                        return;
                      }
                      if (!userExpanded && userInsights.length === 0 && !requireSubscription()) return;
                      setOpenUserInsights(userExpanded ? null : verse.reference);
                      if (!userExpanded) {
                        openHiddenVerseChallenge(sourceNarrativeId, verse.reference);
                      }
                    }}>
                      {userExpanded ? 'Close' : hiddenVerseMarker ? 'Open tag' : userInsights.length ? `Open ${userInsights.length}` : 'Add yours'}
                    </button>
                  </div>
                  {!userExpanded && participants.length > 0 && (
                    <div
                      className="mt-3 flex max-w-full items-center gap-1.5 overflow-x-auto pb-1"
                      aria-label={`${participants.length} reader insight participant${participants.length === 1 ? '' : 's'}`}
                    >
                      {participants.map((participant) => participant.isGuest ? (
                        <span
                          key={participant.userId}
                          title="Guest reader"
                          className="inline-flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-peri-soft text-peri"
                        >
                          <Dove size={14} />
                        </span>
                      ) : (
                        <MessageAvatar
                          key={participant.userId}
                          profile={messageProfile(participant.userId, participant.displayName, participant.avatarUrl)}
                          currentUserId={profile?.id}
                          size="xs"
                          className="shrink-0"
                        />
                      ))}
                    </div>
                  )}
                  {userExpanded && (
                    <div className="mt-3 space-y-3">
                      {userInsights.map((item: any) => {
                        const authorName = item.profiles?.display_name || 'Reader';
                        const comments = item.comments || [];
                        const repliesOpen = openInsightReplies === item.id;
                        const commentsVisible = isSundayRest || repliesOpen;
                        return (
                          <div key={item.id} className="rounded-xl border border-border bg-surface-2 p-3">
                            <div className="flex items-start gap-2.5">
                              <MessageAvatar
                                profile={messageProfile(item.user_id, authorName, item.profiles?.avatar_url)}
                                currentUserId={profile?.id}
                                size="sm"
                              />
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-bold text-ink">{authorName}{item.user_id === profile?.id ? ' · You' : ''}</p>
                                {editingInsightId === item.id ? (
                                  <div className="mt-1 flex items-end gap-2">
                                    <textarea value={editingInsightBody} onChange={(event) => setEditingInsightBody(event.target.value)} className="input-field min-h-16 flex-1 text-xs" autoFocus />
                                    <button type="button" onClick={() => void submitInsightEdit()} className="icon-btn" aria-label="Save insight"><Check size={13} /></button>
                                  </div>
                                ) : <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-stone">{item.body}</p>}
                                {item.user_id === profile?.id && editingInsightId !== item.id && <button type="button" className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-peri" onClick={() => { if (!requireSubscription()) return; setEditingInsightId(item.id); setEditingInsightBody(item.body); }}><Pencil size={10} /> Edit</button>}
                              </div>
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-1.5" aria-label={`Reactions to ${authorName}'s insight`}>
                              {INSIGHT_REACTIONS.map(({ type, label, icon: ReactionIcon }) => {
                                const reaction = item.reactions?.[type] || { count: 0, reacted: false };
                                const pending = reactionPendingKey === `${item.id}:${type}`;
                                return (
                                  <button
                                    key={type}
                                    type="button"
                                    disabled={Boolean(reactionPendingKey)}
                                    onClick={() => void reactToInsight(item.id, type)}
                                    className={cn(
                                      'inline-flex h-7 min-w-9 items-center justify-center gap-1 rounded-full border px-2 text-[10px] font-bold transition-colors disabled:opacity-60',
                                      reaction.reacted
                                        ? type === 'heart'
                                          ? 'border-coral/50 bg-coral-soft text-coral'
                                          : 'border-gold/50 bg-gold-soft text-gold'
                                        : 'border-border bg-surface text-stone hover:border-border-bright hover:text-ink',
                                      pending && 'animate-pulse',
                                    )}
                                    title={label}
                                    aria-label={`${label}: ${reaction.count}`}
                                    aria-pressed={reaction.reacted}
                                    aria-busy={pending}
                                  >
                                    <ReactionIcon size={13} fill={reaction.reacted ? 'currentColor' : 'none'} />
                                    <span>{reaction.count}</span>
                                  </button>
                                );
                              })}
                            </div>
                            {(() => {
                              const actors = Array.from(new Map(
                                INSIGHT_REACTIONS.flatMap(({ type }) => item.reactions?.[type]?.actors || [])
                                  .map((actor: any) => [actor.user_id, actor]),
                              ).values()).slice(0, 5);
                              if (!actors.length) return null;
                              return (
                                <div className="mt-2 flex items-center -space-x-2" aria-label={`${actors.length} camp member${actors.length === 1 ? '' : 's'} reacted`}>
                                  {actors.map((actor: any) => actor.is_guest ? (
                                    <span
                                      key={actor.user_id}
                                      title="Guest reader"
                                      className="inline-flex h-4 w-4 items-center justify-center overflow-hidden rounded-full border border-surface-2 bg-peri-soft text-peri shadow-sm"
                                    >
                                      <Dove size={14} />
                                    </span>
                                  ) : (
                                    <MessageAvatar
                                      key={actor.user_id}
                                      profile={messageProfile(actor.user_id, actor.display_name, actor.avatar_url)}
                                      currentUserId={profile?.id}
                                      size="xs"
                                    />
                                  ))}
                                </div>
                              );
                            })()}
                            <button type="button" className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-peri" onClick={() => {
                              if (!requireSubscription()) return;
                              setOpenInsightReplies(repliesOpen ? null : item.id);
                              setReplyTargets((current) => ({ ...current, [item.id]: { userId: item.user_id, displayName: authorName } }));
                              setReplyDrafts((current) => ({ ...current, [item.id]: current[item.id] || `@${authorName} ` }));
                            }}>
                              <MessageCircle size={13} /> {comments.length ? `${comments.length} ${comments.length === 1 ? 'reply' : 'replies'}` : 'Reply'}
                            </button>
                            {commentsVisible && (comments.length > 0 || repliesOpen) && (
                              <div className="mt-3 space-y-2 border-l-2 border-peri/25 pl-3">
                                {comments.map((comment: any) => (
                                  <div key={comment.id} className="rounded-lg bg-surface/75 p-2">
                                    <div className="flex items-start gap-2.5">
                                      <MessageAvatar
                                        profile={messageProfile(comment.user_id, comment.profile?.display_name || 'Reader', comment.profile?.avatar_url)}
                                        currentUserId={profile?.id}
                                        size="sm"
                                      />
                                      <div className="min-w-0 flex-1">
                                        <p className="text-[11px] font-bold text-ink">{comment.profile?.display_name || 'Reader'} <RelativeTime value={comment.created_at} className="font-medium text-stone-dim" /></p>
                                        {editingCommentId === comment.id ? (
                                          <div className="mt-1 flex items-end gap-2">
                                            <textarea value={editingCommentBody} onChange={(event) => setEditingCommentBody(event.target.value)} className="input-field min-h-14 flex-1 text-xs" autoFocus />
                                            <button type="button" onClick={() => void submitInsightCommentEdit()} className="icon-btn" aria-label="Save reply"><Check size={12} /></button>
                                          </div>
                                        ) : <p className="mt-0.5 whitespace-pre-wrap text-xs leading-relaxed text-stone">{comment.body}</p>}
                                        {comment.user_id === profile?.id && editingCommentId !== comment.id && <button type="button" className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-peri" onClick={() => { if (!requireSubscription()) return; setEditingCommentId(comment.id); setEditingCommentBody(comment.body); }}><Pencil size={10} /> Edit</button>}
                                        <button type="button" className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-peri" onClick={() => {
                                          if (!requireSubscription()) return;
                                          const displayName = comment.profile?.display_name || 'Reader';
                                          setOpenInsightReplies(item.id);
                                          setReplyTargets((current) => ({ ...current, [item.id]: { userId: comment.user_id, displayName, parentCommentId: comment.id } }));
                                          setReplyDrafts((current) => ({ ...current, [item.id]: `@${displayName} ` }));
                                        }}><Reply size={11} /> Reply</button>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                                {repliesOpen && (
                                  <>
                                    {replyTargets[item.id] && <p className="text-[10px] font-semibold text-peri">Replying to @{replyTargets[item.id]?.displayName}</p>}
                                    <div className="flex items-end gap-2">
                                      <div className="min-w-0 flex-1">
                                        <MentionTextarea className="input-field min-h-[4rem] w-full text-xs" value={replyDrafts[item.id] || ''} onChange={(value) => setReplyDrafts((current) => ({ ...current, [item.id]: value }))} candidates={campMentionCandidates} placeholder={`Respond to @${authorName}...`} />
                                      </div>
                                      <button type="button" className="icon-btn mb-1" aria-label="Post reply" disabled={savingReply === item.id || !(replyDrafts[item.id] || '').trim()} onClick={() => void submitInsightReply(item)}><Send size={15} /></button>
                                    </div>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {hasAccess ? (
                        <>
                          <MentionTextarea
                            className="input-field min-h-[5.5rem] w-full text-sm"
                            value={myInsightDrafts[verse.reference] || ''}
                            onChange={(value) => setMyInsightDrafts((prev) => ({ ...prev, [verse.reference]: value }))}
                            candidates={campMentionCandidates}
                            placeholder="Write your insight on this verse. Type @ to tag someone..."
                          />
                          <button type="button" className="btn-secondary text-xs" disabled={savingInsight === verse.reference || !(myInsightDrafts[verse.reference] || '').trim()} onClick={() => submitVerseInsight(verse.reference, sourceNarrativeId)}>
                            {savingInsight === verse.reference ? 'Saving...' : 'Save my insight'}
                          </button>
                        </>
                      ) : (
                        <button type="button" className="btn-secondary w-full justify-center text-xs" onClick={() => requireSubscription()}>
                          <Lock size={13} /> Subscribe to write an insight
                        </button>
                      )}
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
      </div>

      {/* ── Reflection prompts ── */}
      {!isSundayRest && narrative.reflection_prompts && narrative.reflection_prompts.length > 0 && (
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
      {!isSundayRest && !isHistoricalReading && <div
        className="card relative isolate overflow-hidden border-border bg-surface-2 p-5 animate-slide-up"
        aria-disabled={!hasAccess}
        onClickCapture={(event) => {
          if (hasAccess || !(event.target as HTMLElement).closest('button,input,textarea,[role="button"],label')) return;
          event.preventDefault();
          event.stopPropagation();
          requireSubscription();
        }}
        onFocusCapture={(event) => {
          if (hasAccess) return;
          (event.target as HTMLElement).blur();
          requireSubscription();
        }}
      >
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
          {savedMeditation && (
            <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-stone">
              <input type="checkbox" checked={meditationPublic} onChange={(event) => void changeMeditationVisibility(event.target.checked)} />
              Make my meditation visible from my quote slide
            </label>
          )}
        </div>
      </div>}

      {isHistoricalReading && meditation && (
        <div className="card relative isolate overflow-hidden border-border bg-surface-2 p-5 animate-slide-up">
          <PanelImageBackdrop image={meditationImage} opacityFallback={100} veilClassName="" modeFilter={false} textGradient={false} />
          <div className="panel-veil-layer award-panel-veil pointer-events-none absolute" aria-hidden="true" />
          <div className="relative z-10">
            <p className="eyebrow text-stone">Your Meditation</p>
            {bestVerse && <p className="mt-2 text-xs font-semibold text-brass">Best verse: {bestVerse}</p>}
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink">{meditation}</p>
            {dailyQuote && <p className="mt-3 text-sm italic text-stone">&ldquo;{dailyQuote}&rdquo;</p>}
          </div>
        </div>
      )}

      <ReadingArchiveBrowser
        open={showHistory}
        loading={historyLoading}
        readings={readingHistory}
        onToggle={() => { const next = !showHistory; setShowHistory(next); if (next) void loadHistory(); }}
        onOpenReading={(date) => { setArchiveDate(date); setShowHistory(false); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
      />

      {/* ── Challenge — format-aware + reject/resubmit flow ── */}
      {!isSundayRest && !isHistoricalReading && narrative.challenge_active && narrative.challenge_title && (
        <div
          className="card relative isolate overflow-hidden border-border bg-surface-2 p-5 animate-slide-up"
          aria-disabled={!hasAccess}
          onClickCapture={(event) => {
            if (hasAccess || !(event.target as HTMLElement).closest('button,input,textarea,[role="button"],label')) return;
            event.preventDefault();
            event.stopPropagation();
            requireSubscription();
          }}
          onFocusCapture={(event) => {
            if (hasAccess) return;
            (event.target as HTMLElement).blur();
            requireSubscription();
          }}
        >
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
