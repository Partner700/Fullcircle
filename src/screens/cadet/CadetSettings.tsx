import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { SectionHeader, EmptyState } from '../../components/AppShell';
import { PasswordUpdateFlow } from '../../components/PasswordUpdateFlow';
import { BrowserNotificationSettings } from '../../components/BrowserNotificationSettings';
import { supabase } from '../../lib/supabase';
import { fetchStrictStreak, fetchLedgerTotal, uploadAvatar, getCurrencyForUser, getSubscriptionStatus } from '../../lib/queries';
import { cn, formatDenarii, getTodayISODate } from '../../lib/utils';
import {
  User, Phone, Camera, Loader2, Save, Flame, Coins, Trophy, Award,
  Calendar, TrendingUp, BookOpen, Target, Zap, Clock, CreditCard, Star,
  KeyRound, Eye, EyeOff,
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

export function CadetSettings({ refreshKey = 0, currentStreak = 0 }: CadetSettingsProps) {
  const { profile, refreshProfile } = useAuth();
  const [displayName, setDisplayName] = useState(profile?.display_name || '');
  const [whatsapp, setWhatsapp] = useState(profile?.whatsapp_number || '');
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [stats, setStats] = useState({
    denarii: 0, currentStreak: 0, longestStreak: 0, awardsCount: 0,
    gamesPlayed: 0, quizzesTaken: 0, narrativesRead: 0, relicsOwned: 0,
  });
  const [subStatus, setSubStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordPage, setPasswordPage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    try {
      const [balance, streak, sub] = await Promise.all([
        fetchLedgerTotal(profile.id),
        fetchStrictStreak(profile.id),
        getSubscriptionStatus(profile.id),
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
        currentStreak: Math.max(currentStreak, streak.current_streak),
        longestStreak: Math.max(streak.longest_streak, historicalLongest),
        awardsCount: awardsCount || 0,
        gamesPlayed: gamesPlayed || 0,
        quizzesTaken: quizzesTaken || 0,
        narrativesRead: narrativesRead || 0,
        relicsOwned,
      });
      setSubStatus(sub);
    } catch {}
    setLoading(false);
  }, [profile, refreshKey, currentStreak]);

  useEffect(() => { load(); }, [load]);

  const saveWhatsapp = async () => {
    if (!profile) return;
    setSaving(true);
    const { error } = await supabase.from('profiles').update({ display_name: displayName.trim() || profile.display_name, whatsapp_number: whatsapp }).eq('id', profile.id);
    if (error) alert(error.message);
    else await refreshProfile();
    setSaving(false);
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !profile) return;
    setUploadingAvatar(true);
    try {
      await uploadAvatar(profile.id, file);
      await refreshProfile();
    } catch (err: any) {
      alert(err.message || 'Failed to upload avatar');
    }
    setUploadingAvatar(false);
  };

  const changePassword = async () => {
    setPasswordError(null);
    setPasswordMessage(null);
    if (newPassword.length < 6) {
      setPasswordError('Password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match.');
      return;
    }
    setChangingPassword(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setChangingPassword(false);
    if (error) {
      setPasswordError(error.message);
      return;
    }
    setNewPassword('');
    setConfirmPassword('');
    setPasswordMessage('Password changed successfully.');
  };

  if (loading) return <div className="flex justify-center py-8"><Loader2 size={24} className="animate-spin text-brass" /></div>;
  if (passwordPage) return <PasswordUpdateFlow email={profile?.email || ''} onDone={() => setPasswordPage(false)} />;

  const trialCountdown = getCountdownParts(subStatus?.trial_ends_at);
  const periodCountdown = getCountdownParts(subStatus?.current_period_end);

  const statCards = [
    { label: 'Denarii', value: formatDenarii(stats.denarii), icon: Coins, color: 'text-gold' },
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
          <div className="relative group">
            <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-border bg-surface-2 flex items-center justify-center">
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt={profile.display_name} className="w-full h-full object-cover" />
              ) : (
                <span className="font-display font-bold text-2xl text-stone">
                  {profile?.display_name?.charAt(0).toUpperCase() || '?'}
                </span>
              )}
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingAvatar}
              className="absolute inset-0 rounded-full bg-ink/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
            >
              {uploadingAvatar ? <Loader2 size={20} className="animate-spin text-white" /> : <Camera size={20} className="text-white" />}
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" />
          </div>
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
            <button onClick={saveWhatsapp} disabled={saving || !displayName.trim()} className="btn-secondary text-sm whitespace-nowrap">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
            </button>
          </div>
          <label className="text-xs text-stone block mb-1 flex items-center gap-1">
            <Phone size={12} /> WhatsApp Number (so your sentry and instructor can contact you)
          </label>
          <div className="flex gap-2">
            <input className="input-field" placeholder="+1234567890" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
            <button onClick={saveWhatsapp} disabled={saving} className="btn-primary text-sm whitespace-nowrap">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
            </button>
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
    </div>
  );
}

function PasswordField({
  label, value, visible, onToggle, onChange,
}: {
  label: string;
  value: string;
  visible: boolean;
  onToggle: () => void;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="text-xs text-stone block mb-1">{label}</label>
      <div className="relative">
        <input
          className="input-field pr-10"
          type={visible ? 'text' : 'password'}
          value={value}
          minLength={6}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          onClick={onToggle}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-stone hover:text-ink transition-colors"
          aria-label={visible ? 'Hide password' : 'Show password'}
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </div>
  );
}
