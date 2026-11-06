import { useEffect, useState } from 'react';
import { Home, Link, Loader2 } from 'lucide-react';
import { AppShell } from '../components/AppShell';
import { BirthdayReactions } from '../components/BirthdayReactions';
import { PanelImageBackdrop } from '../components/PanelImageBackdrop';
import { UserAvatar } from '../components/UserAvatar';
import { SubscriptionGate, SubscriptionScreen } from '../components/SubscriptionScreen';
import { useAuth } from '../context/AuthContext';
import { SubscriptionAccessProvider, subscriptionIsExpired } from '../context/SubscriptionAccessContext';
import { fetchPublicBirthdayAnnouncement, type PublicBirthdayView } from '../lib/birthdays';
import { getSubscriptionStatus } from '../lib/queries';
import { supabase } from '../lib/supabase';
import { signalActiveQuizExitIntent } from '../lib/quizIntegrity';
import type { QuizSession, ScheduledAnnouncement } from '../lib/types';
import type { ShareDestination } from '../lib/shareDestination';
import { CadetNarrative } from './cadet/CadetNarrative';
import { CadetQuiz } from './cadet/CadetQuiz';
import { CadetGame } from './cadet/CadetGame';
import { CadetArena } from './cadet/CadetArena';

function SharedQuiz({ id }: { id: string }) {
  const [session, setSession] = useState<QuizSession | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void supabase.from('quiz_sessions').select('*').eq('id', id).maybeSingle().then(({ data, error: failure }) => {
      if (!active) return;
      if (failure || !data) setError('This quiz is unavailable or you do not have access to it.');
      else setSession(data as QuizSession);
    }, () => { if (active) setError('This quiz could not load. Reopen the link to retry.'); });
    return () => { active = false; };
  }, [id]);
  if (error) return <p role="alert" className="card p-5 text-coral">{error}</p>;
  return session ? <CadetQuiz sharedSession={session} onQuizSubmitted={() => {}} /> : <p role="status">Opening your quiz…</p>;
}

function SharedBirthday({ id, date }: { id: string; date: string }) {
  const [birthday, setBirthday] = useState<PublicBirthdayView | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void fetchPublicBirthdayAnnouncement(id, date).then((data) => {
      if (!active) return;
      if (data) setBirthday(data); else setError('This birthday celebration is no longer available.');
    }, () => { if (active) setError('The birthday celebration could not load. Reopen the link to retry.'); });
    return () => { active = false; };
  }, [date, id]);
  if (error) return <p role="alert">{error}</p>;
  if (!birthday) return <p role="status">Opening the birthday celebration…</p>;
  const announcement: ScheduledAnnouncement = { ...birthday, announcement_type: 'birthday', audience: 'all', is_active: true };
  return <article className="card relative isolate overflow-hidden p-6">
    <PanelImageBackdrop image={birthday.panel_image} opacityFallback={42} veilClassName="welcome-slide-veil" />
    <div className="relative z-10 space-y-4">
      <UserAvatar userId={birthday.metadata.user_id} name={birthday.metadata.display_name || 'Birthday celebrant'} avatarUrl={birthday.metadata.avatar_url} className="h-20 w-20" />
      <h1 className="font-display text-2xl font-bold text-ink">{birthday.metadata.display_name}</h1>
      <p className="whitespace-pre-wrap text-ink">{birthday.content}</p>
      <BirthdayReactions announcement={announcement} active onOpenChange={() => {}} onMessageOpenChange={() => {}} />
    </div>
  </article>;
}

export function MemberShareDestination({ target, onHome }: { target: ShareDestination; onHome: () => void }) {
  const { profile, role } = useAuth();
  const [status, setStatus] = useState<Awaited<ReturnType<typeof getSubscriptionStatus>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [subscribe, setSubscribe] = useState(false);
  useEffect(() => {
    let active = true;
    if (!profile?.id) return;
    setLoading(true); setError('');
    void getSubscriptionStatus(profile.id).then((data) => { if (active) setStatus(data); }, () => {
      if (active) setError('Your access could not be checked. Please retry.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [profile?.id, retry]);
  const expired = role !== 'instructor' && subscriptionIsExpired(status);
  const protectedTarget = target.kind === 'quiz' || target.kind === 'game' || target.kind === 'arena';
  const title = { reading: 'Bible reading', quiz: 'Quiz', game: 'Daily Trivia', arena: 'Arena', birthday: 'Birthday celebration' }[target.kind];
  const home = () => { signalActiveQuizExitIntent(); onHome(); };
  return <AppShell headerTitle={title} activeKey={subscribe ? 'subscribe' : 'shared'}
    navItems={[{ key: 'home', label: 'Home', icon: Home }, { key: 'shared', label: title, icon: Link }]}
    onNavigate={(key) => { if (key === 'home') home(); else setSubscribe(false); }}>
    <SubscriptionAccessProvider isExpired={expired} onSubscriptionRequired={() => setSubscribe(true)}>
      {subscribe ? <SubscriptionScreen subStatus={status} onActivated={(next) => { setStatus(next); setSubscribe(false); }} />
        : protectedTarget && loading ? <p role="status"><Loader2 className="animate-spin" />Opening {title}…</p>
        : protectedTarget && error ? <div role="alert">{error}<button className="btn-secondary" onClick={() => setRetry((n) => n + 1)}>Retry</button></div>
        : protectedTarget && expired ? <SubscriptionGate onSubscribe={() => setSubscribe(true)} />
        : target.kind === 'reading' ? <CadetNarrative initialDate={target.date} />
        : target.kind === 'quiz' ? <SharedQuiz id={target.id} />
        : target.kind === 'game' ? <CadetGame initialDate={target.date} onRewardEarned={() => {}} onBackToDailyGames={home} />
        : target.kind === 'arena' ? <CadetArena witnessOnly={role === 'instructor'} initialRoomId={target.id} onBackToDailyGames={home} />
        : <SharedBirthday id={target.id} date={target.date} />}
    </SubscriptionAccessProvider>
  </AppShell>;
}
