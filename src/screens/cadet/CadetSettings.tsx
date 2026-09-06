import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { SectionHeader } from '../../components/AppShell';
import { PasswordUpdateFlow } from '../../components/PasswordUpdateFlow';
import { BrowserNotificationSettings } from '../../components/BrowserNotificationSettings';
import { supabase } from '../../lib/supabase';
import { fetchStrictStreak, fetchLedgerTotal, fetchUserLiveStats, getSubscriptionStatus } from '../../lib/queries';
import { cn, formatDenarii } from '../../lib/utils';
import { PROFILE_COUNTRIES, PROFILE_LANGUAGES } from '../../lib/profileOptions';
import { formatBirthdayInput, formatBirthdayTyping, parseBirthdayInput, saveOwnProfilePreferences } from '../../lib/profilePreferences';
import { AppSelect } from '../../components/AppSelect';
import { DeleteAccountSection } from '../../components/DeleteAccountSection';
import { ProfilePhotoEditor } from '../../components/ProfilePhotoEditor';
import { ChiRhoMark } from '../../components/ChiRhoMark';
import {
  User, Phone, Loader2, Save, Flame, Coins, Award,
  Calendar, TrendingUp, BookOpen, Target, Zap, Clock, CreditCard, Star,
  BadgeCheck, Cake, Globe2, KeyRound, Languages, Shield,
} from 'lucide-react';

interface CadetSettingsProps {
  refreshKey?: number;
  currentStreak?: number;
}

function getCountdownParts(target?: string | null) {
  const targetMs = target ? new Date(target).getTime() : NaN;
  const remainingMs = Number.isFinite(targetMs) ? Math.max(0, targetMs - Date.now()) : 0;
  const days = Math.floor(remainingMs / 86_400_000);
  const hours = Math.floor((remainingMs % 86_400_000) / 3_600_000);
  const minutes = Math.floor((remainingMs % 3_600_000) / 60_000);
  return { days, hours, minutes, label: `${days}d ${hours}h ${minutes}m` };
}

export function CadetSettings({ refreshKey = 0 }: CadetSettingsProps) {
  const { profile, refreshProfile } = useAuth();
  const [displayName, setDisplayName] = useState(profile?.display_name || '');
  const [whatsapp, setWhatsapp] = useState(profile?.whatsapp_number || '');
  const [country, setCountry] = useState(profile?.country_code || 'CM');
  const [language, setLanguage] = useState(profile?.language_code || 'en');
  const [birthday, setBirthday] = useState(formatBirthdayInput(profile?.birth_month, profile?.birth_day));
  const [saving, setSaving] = useState(false);
  const [stats, setStats] = useState({
    denarii: 0, currentStreak: 0, longestStreak: 0, awardsCount: 0,
    figs: 0, rhudes: 0, marks: 0, gamesPlayed: 0, quizzesTaken: 0, narrativesRead: 0, relicsOwned: 0,
  });
  const [subStatus, setSubStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [passwordPage, setPasswordPage] = useState(false);

  const load = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    try {
      const [balance, streak, sub, liveStats] = await Promise.all([
        fetchLedgerTotal(profile.id),
        fetchStrictStreak(profile.id),
        getSubscriptionStatus(profile.id),
        fetchUserLiveStats(profile.id).catch(() => null),
      ]);

      const { count: gamesPlayed } = await supabase
        .from('game_attempts')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', profile.id);

      const { count: quizzesTaken } = await supabase
        .from('quiz_attempts')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', profile.id);

      const { count: narrativesRead } = await supabase
        .from('daily_records')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', profile.id)
        .eq('meditation_submitted', true);

      const { data: streakRecords } = await supabase
        .from('daily_records')
        .select('record_date, streak_valid')
        .eq('user_id', profile.id)
        .order('record_date', { ascending: true });
      let historicalLongest = 0;
      let run = 0;
      (streakRecords || []).forEach((record: any) => {
        if (record.streak_valid) {
          run += 1;
          historicalLongest = Math.max(historicalLongest, run);
        } else {
          run = 0;
        }
      });

      const { count: awardsCount } = await supabase
        .from('awards')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', profile.id);

      const { data: relics } = await supabase
        .from('relic_inventory')
        .select('quantity')
        .eq('user_id', profile.id);
      const relicsOwned = (relics || []).reduce((sum: number, r: any) => sum + (r.quantity || 0), 0);

      setStats({
        denarii: balance,
        currentStreak: streak.current_streak,
        longestStreak: Math.max(streak.longest_streak, historicalLongest),
        awardsCount: awardsCount || 0,
        figs: Number(liveStats?.total_figs || 0),
        rhudes: Number(liveStats?.rhudes || 0),
        marks: Number(liveStats?.marks || 0),
        gamesPlayed: gamesPlayed || 0,
        quizzesTaken: quizzesTaken || 0,
        narrativesRead: narrativesRead || 0,
        relicsOwned,
      });
      window.dispatchEvent(new CustomEvent('full-circle-toolbar-stats', {
        detail: {
          userId: profile.id,
          denarii: balance,
          streak: streak.current_streak,
          marks: Number(liveStats?.marks || 0),
        },
      }));
      setSubStatus(sub);
    } catch {}
    setLoading(false);
  }, [profile]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const saveProfile = async () => {
    if (!profile) return;
    setSaving(true);
    try {
      const parsedBirthday = parseBirthdayInput(birthday);
      await saveOwnProfilePreferences({
        displayName: displayName.trim() || profile.display_name,
        whatsappNumber: whatsapp,
        countryCode: country,
        languageCode: language,
        birthMonth: parsedBirthday.month,
        birthDay: parsedBirthday.day,
      });
      document.documentElement.lang = language;
      await refreshProfile();
    } catch (error: any) {
      alert(error.message || 'Could not save profile settings.');
    }
    setSaving(false);
  };

  if (loading) return <div className="flex justify-center py-8"><Loader2 size={24} className="animate-spin text-brass" /></div>;
  if (passwordPage) return <PasswordUpdateFlow email={profile?.email || ''} onDone={() => setPasswordPage(false)} />;

  const trialCountdown = getCountdownParts(subStatus?.trial_ends_at);
  const periodCountdown = getCountdownParts(subStatus?.current_period_end);

  const statCards = [
    { label: 'Denarii', value: formatDenarii(stats.denarii), icon: Coins, color: 'text-gold' },
    { label: 'Figs', value: stats.figs.toLocaleString(), icon: BadgeCheck, color: 'text-sage' },
    { label: 'Rhudes', value: stats.rhudes.toLocaleString(), icon: Shield, color: 'text-royal' },
    { label: 'Marks', value: stats.marks.toLocaleString(undefined, { maximumFractionDigits: 2 }), icon: ChiRhoMark, color: 'text-peri-2' },
    { label: 'Current Streak', value: `${stats.currentStreak} days`, icon: Flame, color: 'text-brass' },
    { label: 'Longest Streak', value: `${stats.longestStreak} days`, icon: TrendingUp, color: 'text-roman' },
    { label: 'Awards', value: stats.awardsCount, icon: Award, color: 'text-royal' },
    { label: 'Games Played', value: stats.gamesPlayed, icon: Target, color: 'text-peri-2' },
    { label: 'Quizzes Taken', value: stats.quizzesTaken, icon: Zap, color: 'text-sage' },
    { label: 'Meditations', value: stats.narrativesRead, icon: BookOpen, color: 'text-moss' },
    { label: 'Relics Owned', value: stats.relicsOwned, icon: Star, color: 'text-gold' },
    { label: 'Member Since', value: profile?.created_at ? new Date(profile.created_at).toLocaleDateString() : '—', icon: Calendar, color: 'text-stone' },
  ];

  return (
    <div className="space-y-5 animate-fade-in max-w-3xl mx-auto">
      <SectionHeader title="Settings" subtitle="Your profile, stats, and preferences" />

      {/* Profile card with avatar */}
      <div className="card p-5">
        <h4 className="font-display font-semibold text-ink mb-4">Profile</h4>
        <div className="flex items-center gap-4 mb-4">
          <ProfilePhotoEditor profile={profile} onUploaded={refreshProfile} />
          <div className="flex-1">
            <p className="font-display font-semibold text-ink text-lg">{profile?.display_name}</p>
            <p className="text-sm text-stone">{profile?.email}</p>
            <p className="text-xs text-stone mt-1">Role: Cadet</p>
          </div>
        </div>

        <div>
          <label className="text-xs text-stone block mb-1 flex items-center gap-1">
            <User size={12} /> User Name
          </label>
          <div className="flex gap-2 mb-3">
            <input className="input-field" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            <button onClick={saveProfile} disabled={saving || !displayName.trim()} className="btn-secondary text-sm whitespace-nowrap">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
            </button>
          </div>
          <label className="text-xs text-stone block mb-1 flex items-center gap-1">
            <Phone size={12} /> WhatsApp Number (so your sentry and instructor can contact you)
          </label>
          <div className="flex gap-2">
            <input className="input-field" placeholder="+1234567890" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
            <button onClick={saveProfile} disabled={saving} className="btn-primary text-sm whitespace-nowrap">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
            </button>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-stone">
              <span className="mb-1 flex items-center gap-1"><Globe2 size={12} /> Country</span>
              <AppSelect value={country} onChange={setCountry} options={PROFILE_COUNTRIES.map((item) => ({ value: item.code, label: item.name, description: item.timezone }))} />
            </label>
            <label className="block text-xs text-stone">
              <span className="mb-1 flex items-center gap-1"><Languages size={12} /> Language</span>
              <AppSelect value={language} onChange={setLanguage} options={PROFILE_LANGUAGES.map((item) => ({ value: item.code, label: item.name }))} />
            </label>
            <label className="block text-xs text-stone">
              <span className="mb-1 flex items-center gap-1"><Cake size={12} /> Birthday</span>
              <input className="input-field" value={birthday} onChange={(event) => setBirthday(formatBirthdayTyping(event.target.value))} placeholder="MM/DD" inputMode="numeric" />
            </label>
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <div className="card p-5">
        <h4 className="font-display font-semibold text-ink mb-4">My Stats</h4>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {statCards.map((s) => {
            const Icon = s.icon;
            return (
              <div key={s.label} className="p-3 rounded-lg bg-surface-2 border border-border text-center">
                <Icon size={18} className={cn('mx-auto mb-1.5', s.color)} />
                <p className="font-display font-bold text-ink text-lg">{s.value}</p>
                <p className="text-xs text-stone">{s.label}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Password */}
      <div className="card p-5">
        <h4 className="font-display font-semibold text-ink mb-3 flex items-center gap-2">
          <KeyRound size={18} className="text-royal" /> Change Password
        </h4>
        <p className="text-xs text-stone mb-3">Confirm your old password first, then set the new one.</p>
        <button onClick={() => setPasswordPage(true)} className="btn-primary text-sm">
          <KeyRound size={14} /> Update Password
        </button>
      </div>

      <BrowserNotificationSettings />

      {/* Subscription */}
      <div className="card p-5">
        <h4 className="font-display font-semibold text-ink mb-3 flex items-center gap-2">
          <CreditCard size={18} className="text-gold" /> Subscription
        </h4>
        {subStatus?.status === 'trial' && (
          <div className="p-3 rounded-lg bg-gold-soft border border-gold/30 mb-3">
            <p className="text-sm text-ink flex items-center gap-2">
              <Clock size={14} className="text-gold" />
              Free trial active — <span className="font-semibold text-coral">{trialCountdown.label}</span>
            </p>
          </div>
        )}
        {subStatus?.status === 'active' && (
          <div className="p-3 rounded-lg bg-sage-soft border border-sage/30 mb-3">
            <p className="text-sm text-ink flex items-center gap-2">
              <Star size={14} className="text-sage" /> Subscription active
              {subStatus?.current_period_end && (
                <span className="font-semibold">
                  — <span className="text-coral">{periodCountdown.label}</span>
                </span>
              )}
            </p>
          </div>
        )}
        {subStatus?.status === 'expired' && (
          <div className="p-3 rounded-lg bg-coral-soft border border-coral/30 mb-3">
            <p className="text-sm text-coral flex items-center gap-2">
              <Clock size={14} /> Your trial has expired. Subscribe to unlock games, quizzes, and more.
            </p>
          </div>
        )}
        <p className="text-xs text-stone">
          {subStatus?.is_paid
            ? `You have an active paid subscription${subStatus?.current_period_end ? ` until ${new Date(subStatus.current_period_end).toLocaleDateString()}` : ''}.`
            : <>You are on the free trial with <span className="font-semibold text-coral">{trialCountdown.label}</span> remaining. Upgrade to keep playing after the trial ends.</>}
        </p>
      </div>

      <DeleteAccountSection />
    </div>
  );
}
