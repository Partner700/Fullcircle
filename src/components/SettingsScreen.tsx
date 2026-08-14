import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { fetchLedgerTotal, fetchRelicInventory, fetchAwards, uploadAvatar, fetchStrictStreak, fetchQuizScoreboard, fetchRhudeBoard, fetchMarksBoard } from '../lib/queries';
import { formatDenarii, formatDate } from '../lib/utils';
import { Dove } from './Dove';
import { PasswordUpdateFlow } from './PasswordUpdateFlow';
import { BrowserNotificationSettings } from './BrowserNotificationSettings';
import { PROFILE_COUNTRIES, PROFILE_LANGUAGES } from '../lib/profileOptions';
import { formatBirthdayInput, parseBirthdayInput, saveOwnProfilePreferences } from '../lib/profilePreferences';
import { StatCard, SectionHeader } from './AppShell';
import {
  CadetIcon, SentryIcon, InstructorIcon,
  TrophyIcon, FlameIcon, CoinIcon, TentIcon, AwardIcon,
} from './BrandIcons';
import { TentHouseBadge } from './TentHouseSymbol';
import { BadgeCheck, Cross, Loader2, Save, LogOut, Mail, Calendar, Shield, ChevronRight, MessageCircle, Camera, Send, X, Globe2, KeyRound, Languages, Cake } from 'lucide-react';
import type { Award } from '../lib/types';

export function SettingsScreen({ onSignOut }: { onSignOut: () => void }) {
  const { profile, role, refreshProfile } = useAuth();
  const [displayName, setDisplayName] = useState(profile?.display_name || '');
  const [whatsapp, setWhatsapp] = useState(profile?.whatsapp_number || '');
  const [country, setCountry] = useState(profile?.country_code || 'CM');
  const [language, setLanguage] = useState(profile?.language_code || 'en');
  const [birthday, setBirthday] = useState(formatBirthdayInput(profile?.birth_month, profile?.birth_day));
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);
  const [tentInfo, setTentInfo] = useState<{ name: string; houseId: string; sentryName?: string } | null>(null);
  const [stats, setStats] = useState<{ denarii: number; streak: number; longestStreak: number; awards: Award[]; relics: number; figs: number; rhudes: number; marks: number }>({
    denarii: 0, streak: 0, longestStreak: 0, awards: [], relics: 0, figs: 0, rhudes: 0, marks: 0,
  });
  const [loading, setLoading] = useState(true);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [showWaMsg, setShowWaMsg] = useState(false);
  const [waMsg, setWaMsg] = useState('');
  const [passwordPage, setPasswordPage] = useState(false);

  const load = useCallback(async () => {
    if (!profile) { setLoading(false); return; }
    setLoading(true);
    try {
    const [balance, streakInfo, awards, relics, memberData, sentryTentData, figBoard, rhudeBoard, marksBoard] = await Promise.allSettled([
      fetchLedgerTotal(profile.id),
      fetchStrictStreak(profile.id),
      fetchAwards(),
      fetchRelicInventory(profile.id),
      supabase.from('tent_members').select('*, tents(*, tent_houses(*))').eq('user_id', profile.id).maybeSingle(),
      supabase.from('tents').select('*, tent_houses(*)').eq('sentry_id', profile.id).maybeSingle(),
      fetchQuizScoreboard(),
      fetchRhudeBoard(),
      fetchMarksBoard(),
    ]);

    const memberRow = memberData.status === 'fulfilled' ? memberData.value.data : null;
    const sentryTentRow = sentryTentData.status === 'fulfilled' ? sentryTentData.value.data : null;
    const awardsList = awards.status === 'fulfilled' ? awards.value : [];
    const ownTentId = (memberRow as any)?.tent_id || (sentryTentRow as any)?.id || null;
    const myAwards = awardsList.filter((award) => (
      award.award_target_type === 'tent'
        ? !!ownTentId && award.award_target_id === ownTentId
        : award.user_id === profile.id
    ));

    let tent: { name: string; houseId: string; sentryName?: string } | null = null;
    const tentRow = (memberRow as any)?.tents || sentryTentRow;
    if (tentRow) {
      const t = tentRow as any;
      let sentryName: string | undefined;
      if (t.sentry_id && t.sentry_id !== profile.id) {
        const { data: sentryProfile } = await supabase.from('profiles').select('display_name').eq('id', t.sentry_id).maybeSingle();
        sentryName = sentryProfile?.display_name;
      }
      tent = { name: t.name, houseId: t.tent_house_id, sentryName };
    }

    let figTotal = figBoard.status === 'fulfilled' ? Number(figBoard.value.find((row) => row.user_id === profile.id)?.total_score || 0) : 0;
    let rhudeTotal = rhudeBoard.status === 'fulfilled' ? Number(rhudeBoard.value.find((row) => row.user_id === profile.id)?.rhudes || 0) : 0;
    let marksTotal = marksBoard.status === 'fulfilled' ? Math.round(Number(marksBoard.value.find((row) => row.user_id === profile.id)?.marks || 0)) : 0;

    if (!figTotal || !rhudeTotal || !marksTotal) {
      const [quizAttempts, gameAttempts, arenaWins] = await Promise.allSettled([
        supabase.from('quiz_attempts').select('figs_scored,talents_scored,score').eq('user_id', profile.id),
        supabase.from('game_attempts').select('score').eq('user_id', profile.id),
        supabase.from('arena_rooms').select('id', { count: 'exact', head: true }).eq('winner_id', profile.id).eq('status', 'completed'),
      ]);
      if (!figTotal) {
        const quizFigs = quizAttempts.status === 'fulfilled'
          ? (quizAttempts.value.data || []).reduce((sum: number, row: any) => sum + Number(row.figs_scored ?? row.talents_scored ?? row.score ?? 0), 0)
          : 0;
        const gameFigs = gameAttempts.status === 'fulfilled'
          ? (gameAttempts.value.data || []).reduce((sum: number, row: any) => sum + Number(row.score || 0), 0)
          : 0;
        figTotal = quizFigs + gameFigs;
      }
      if (!rhudeTotal && arenaWins.status === 'fulfilled') rhudeTotal = Number(arenaWins.value.count || 0);
      if (!marksTotal) {
        const denariiTotal = balance.status === 'fulfilled' ? balance.value : 0;
        const streakTotal = streakInfo.status === 'fulfilled' ? streakInfo.value.current_streak : 0;
        marksTotal = Math.round(denariiTotal + figTotal * 100 + streakTotal * 1000 + rhudeTotal * 5000);
      }
    }

    setStats({
      denarii: balance.status === 'fulfilled' ? balance.value : 0,
      streak: streakInfo.status === 'fulfilled' ? streakInfo.value.current_streak : 0,
      longestStreak: streakInfo.status === 'fulfilled' ? streakInfo.value.longest_streak : 0,
      awards: myAwards,
      relics: relics.status === 'fulfilled' ? relics.value.length : 0,
      figs: figTotal,
      rhudes: rhudeTotal,
      marks: marksTotal,
    });
    setTentInfo(tent);
    } catch (e) { console.error('Settings load error:', e); }
    setLoading(false);
  }, [profile]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!profile) return;
    setSaving(true);
    try {
      const parsedBirthday = parseBirthdayInput(birthday);
      await saveOwnProfilePreferences({
        displayName,
        whatsappNumber: whatsapp || null,
        countryCode: country,
        languageCode: language,
        birthMonth: parsedBirthday.month,
        birthDay: parsedBirthday.day,
      });
      document.documentElement.lang = language;
      await refreshProfile();
      setSavedMsg(true);
      setTimeout(() => setSavedMsg(false), 2000);
    } catch (error: any) {
      alert(error.message || 'Could not save profile settings.');
    }
    setSaving(false);
  };

  const roleIcon = role === 'cadet' ? CadetIcon : role === 'sentry' ? SentryIcon : InstructorIcon;
  const RoleIcon = roleIcon;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={24} className="animate-spin text-peri-dim" />
      </div>
    );
  }
  if (passwordPage) return <PasswordUpdateFlow email={profile?.email || ''} onDone={() => setPasswordPage(false)} />;

  return (
    <div className="space-y-5 animate-fade-in max-w-3xl mx-auto">
      {/* Profile header card */}
      <div className="card p-6 animate-slide-up">
        <div className="flex items-center gap-4 mb-5">
          <div className="relative w-16 h-16 rounded-2xl overflow-hidden border border-border-bright bg-peri-soft flex items-center justify-center flex-shrink-0">
            {profile?.avatar_url ? (
              <img src={profile.avatar_url} alt={profile?.display_name} className="w-full h-full object-cover" />
            ) : (
              <RoleIcon size={32} className="text-peri" />
            )}
            <button
              onClick={() => document.getElementById('avatar-upload-input')?.click()}
              className="absolute bottom-0 right-0 w-6 h-6 rounded-tl-lg bg-peri text-white flex items-center justify-center"
              title="Upload photo"
            >
              <Camera size={12} />
            </button>
            <input
              id="avatar-upload-input"
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file || !profile) return;
                setUploadingAvatar(true);
                try { await uploadAvatar(profile.id, file); await refreshProfile(); await load(); } catch (err: any) { alert(err.message || 'Upload failed'); }
                setUploadingAvatar(false);
              }}
            />
            {uploadingAvatar && <div className="absolute inset-0 bg-ink/50 flex items-center justify-center"><Loader2 size={16} className="animate-spin text-white" /></div>}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-display text-2xl text-peri truncate">{profile?.display_name}</h2>
            <p className="text-peri-dim text-sm flex items-center gap-1.5 mt-0.5">
              <Mail size={14} /> {profile?.email}
            </p>
            <div className="flex items-center gap-2 mt-1.5">
              <span className="badge badge-peri capitalize">{role}</span>
              {tentInfo && <TentHouseBadge houseId={tentInfo.houseId} size="sm" />}
            </div>
          </div>
        </div>

        {/* Edit display name */}
        <div className="border-t border-border pt-4">
          <label className="block text-sm font-bold text-peri mb-1.5">Display Name</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="input-field flex-1"
              placeholder="Your name"
            />
            <button onClick={handleSave} disabled={saving || displayName === profile?.display_name} className="btn-primary">
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              Save
            </button>
          </div>
          {savedMsg && <p className="text-sage text-xs mt-2 font-medium">Saved successfully</p>}
        </div>

        {/* WhatsApp number */}
        <div className="border-t border-border pt-4 mt-4">
          <label className="block text-sm font-bold text-peri mb-1.5">WhatsApp Number</label>
          <p className="text-xs text-peri-dim mb-2">For your sentry/instructor to contact you, and (if you're a sentry) for cadets to reach you.</p>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <MessageCircle size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-peri-dim" />
              <input
                type="tel"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                className="input-field pl-10"
                placeholder="+1234567890"
              />
            </div>
            <button onClick={handleSave} disabled={saving} className="btn-primary">
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              Save
            </button>
          </div>
          {whatsapp && (
            <button onClick={() => setShowWaMsg(true)} className="text-xs text-sage hover:text-sage-dark flex items-center gap-1 mt-2">
              <MessageCircle size={12} /> Send WhatsApp message
            </button>
          )}
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-bold text-peri">
              <span className="mb-1.5 flex items-center gap-1"><Globe2 size={13} /> Country</span>
              <select className="input-field" value={country} onChange={(event) => setCountry(event.target.value)}>
                {PROFILE_COUNTRIES.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
              </select>
            </label>
            <label className="block text-xs font-bold text-peri">
              <span className="mb-1.5 flex items-center gap-1"><Languages size={13} /> Language</span>
              <select className="input-field" value={language} onChange={(event) => setLanguage(event.target.value)}>
                {PROFILE_LANGUAGES.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
              </select>
            </label>
            <label className="block text-xs font-bold text-peri">
              <span className="mb-1.5 flex items-center gap-1"><Cake size={13} /> Birthday</span>
              <input className="input-field" value={birthday} onChange={(event) => setBirthday(event.target.value)} placeholder="MM/DD" inputMode="numeric" />
            </label>
          </div>
        </div>
      </div>

      {/* WhatsApp message modal */}
      {showWaMsg && (
        <div className="fixed inset-0 bg-ink/50 flex items-center justify-center z-50 p-4 animate-fade-in" onClick={() => setShowWaMsg(false)}>
          <div className="card p-5 max-w-sm w-full animate-scale-in" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-display text-lg font-semibold text-ink">Send WhatsApp Message</h3>
              <button onClick={() => setShowWaMsg(false)} className="text-stone hover:text-ink"><X size={20} /></button>
            </div>
            <textarea
              className="input-field text-sm mb-3"
              rows={4}
              placeholder="Type your message..."
              value={waMsg}
              onChange={(e) => setWaMsg(e.target.value)}
            />
            <a
              href={`https://wa.me/${(whatsapp || '').replace(/[^0-9]/g, '')}?text=${encodeURIComponent(waMsg || '')}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary w-full text-sm flex items-center justify-center gap-2"
              style={{ background: '#25D366', borderColor: '#25D366' }}
            >
              <Send size={14} /> Send via WhatsApp
            </a>
          </div>
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 animate-slide-up">
        <StatCard icon={CoinIcon} label="Denarii" value={formatDenarii(stats.denarii)} color="#F5B731" />
        <StatCard icon={FlameIcon} label="Streak" value={stats.streak} sublabel={`Best: ${stats.longestStreak}`} color="#E05252" />
        <StatCard icon={BadgeCheck} label="Figs" value={stats.figs} color="#7C8CFF" />
        <StatCard icon={Shield} label="Rhudes" value={stats.rhudes} color="#5BAD7F" />
        <StatCard icon={Cross} label="Marks" value={stats.marks} color="#DDE3FF" />
        <StatCard icon={AwardIcon} label="Awards" value={stats.awards.length} color="#D6A849" />
        <StatCard icon={TrophyIcon} label="Relics" value={stats.relics} color="#A7B0C6" />
      </div>

      {/* Tent info */}
      {tentInfo && (
        <div className="card p-5 animate-slide-up">
          <SectionHeader title="My Tent" />
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-peri-soft flex items-center justify-center flex-shrink-0">
              <TentIcon size={24} className="text-peri" />
            </div>
            <div className="flex-1">
              <p className="font-display font-bold text-peri">{tentInfo.name}</p>
              {tentInfo.sentryName && <p className="text-sm text-peri-dim">Sentry: {tentInfo.sentryName}</p>}
            </div>
            <TentHouseBadge houseId={tentInfo.houseId} size="sm" />
          </div>
        </div>
      )}

      {/* Awards list */}
      {stats.awards.length > 0 && (
        <div className="card p-5 animate-slide-up">
          <SectionHeader title="My Awards" />
          <div className="space-y-2">
            {stats.awards.map((award) => (
              <div key={award.id} className="flex items-center gap-3 p-3 rounded-xl bg-navy-3">
                <AwardIcon size={20} className="text-gold flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-peri truncate">{award.title}</p>
                  <p className="text-xs text-peri-dim">{formatDate(award.award_month)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card p-5 animate-slide-up">
        <SectionHeader title="Password" />
        <p className="text-xs text-peri-dim mb-3">Confirm your old password first, then set the new one.</p>
        <button onClick={() => setPasswordPage(true)} className="btn-primary text-sm">
          <KeyRound size={14} />
          Update Password
        </button>
      </div>

      <BrowserNotificationSettings />

      {/* Account section */}
      <div className="card p-5 animate-slide-up">
        <SectionHeader title="Account" />
        <div className="space-y-2">
          <div className="flex items-center justify-between p-3 rounded-xl bg-navy-3">
            <div className="flex items-center gap-3">
              <Calendar size={18} className="text-peri-dim" />
              <span className="text-sm font-medium text-peri">Member since</span>
            </div>
            <span className="text-sm text-peri-dim">{formatDate(profile?.created_at || new Date())}</span>
          </div>
          <div className="flex items-center justify-between p-3 rounded-xl bg-navy-3">
            <div className="flex items-center gap-3">
              <Shield size={18} className="text-peri-dim" />
              <span className="text-sm font-medium text-peri">Role</span>
            </div>
            <span className="text-sm text-peri capitalize">{role}</span>
          </div>
          <button
            onClick={onSignOut}
            className="w-full flex items-center justify-between p-3 rounded-xl bg-navy-3 hover:bg-coral-soft transition-colors group"
          >
            <div className="flex items-center gap-3">
              <LogOut size={18} className="text-peri-dim group-hover:text-coral" />
              <span className="text-sm font-bold text-peri group-hover:text-coral">Sign Out</span>
            </div>
            <ChevronRight size={18} className="text-peri-dim group-hover:text-coral" />
          </button>
        </div>
      </div>

      {/* Dove footer */}
      <div className="flex justify-center py-4">
        <Dove size={56} className="opacity-30" />
      </div>
    </div>
  );
}
