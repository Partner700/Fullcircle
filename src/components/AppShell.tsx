import { type ElementType, type ReactNode, useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { cn } from '../lib/utils';
import { DoveMark } from './Dove';
import { LogOut, Sun, Moon, Menu, X, Volume2, VolumeX } from 'lucide-react';
import { fetchPanelImageSetting } from '../lib/queries';
import type { PanelImageSetting } from '../lib/types';
import { PanelImageBackdrop } from './PanelImageBackdrop';
import { isSoundscapeEnabled, isSoundscapePlaying, playInterfaceTone, setSoundscapeEnabled, setSoundscapeMood, stopSoundscape, subscribeToSoundscape, type SoundMood } from '../lib/soundscape';

type Theme = 'night' | 'day';

function tabUrl(tab: string) {
  const url = new URL(window.location.href);
  url.hash = `fc-tab=${encodeURIComponent(tab)}`;
  return url.toString();
}

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('fc-theme') as Theme | null;
      if (saved === 'day' || saved === 'night') return saved;
    }
    return 'night';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('fc-theme', theme);
  }, [theme]);

  const toggle = useCallback(() => setTheme((t) => (t === 'night' ? 'day' : 'night')), []);
  return [theme, toggle];
}

function ThemeToggle() {
  const [theme, toggle] = useTheme();
  return (
    <button
      onClick={toggle}
      className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-border bg-navy-3 text-peri-dim transition-all hover:border-border-bright hover:text-peri"
      title={theme === 'night' ? 'Switch to day mode' : 'Switch to night mode'}
    >
      {theme === 'night' ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}

function SoundToggle() {
  const [enabled, setEnabled] = useState(() => isSoundscapeEnabled());
  const [playing, setPlaying] = useState(() => isSoundscapePlaying());
  useEffect(() => subscribeToSoundscape((state) => {
    setEnabled(state.enabled);
    setPlaying(state.playing);
  }), []);
  const toggle = async () => {
    const next = !enabled;
    await setSoundscapeEnabled(next);
    setEnabled(next);
  };
  return (
    <button
      onClick={toggle}
      className="inline-flex h-9 min-w-9 flex-shrink-0 items-center justify-center gap-1.5 rounded-xl border border-border bg-navy-3 px-2 text-peri-dim transition-all hover:border-border-bright hover:text-peri"
      title={enabled ? 'Turn sounds off' : 'Turn sounds on'}
      aria-label={enabled ? 'Turn sounds off' : 'Turn sounds on'}
      aria-pressed={enabled}
    >
      {enabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
      {enabled && (
        <span className={cn('sound-meter', playing && 'is-playing')} aria-hidden="true">
          <span /><span /><span /><span />
        </span>
      )}
    </button>
  );
}

interface NavItem {
  key: string;
  label: string;
  icon: ElementType;
}

interface ShellProps {
  children: ReactNode;
  navItems: NavItem[];
  activeKey: string;
  onNavigate: (key: string) => void;
  headerTitle: string;
  headerSubtitle?: string;
  rightHeader?: ReactNode;
  navBadges?: Record<string, number>;
  showTopSignOut?: boolean;
}

export function AppShell({ children, navItems, activeKey, onNavigate, headerTitle, headerSubtitle, rightHeader, navBadges = {}, showTopSignOut = true }: ShellProps) {
  const { profile, role, signOut } = useAuth();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [weeklyBackground, setWeeklyBackground] = useState<PanelImageSetting | null>(null);
  const activeKeyRef = useRef(activeKey);
  const onNavigateRef = useRef(onNavigate);
  const historyReadyRef = useRef(false);
  const handlingPopStateRef = useRef(false);

  useEffect(() => { activeKeyRef.current = activeKey; }, [activeKey]);
  useEffect(() => { onNavigateRef.current = onNavigate; }, [onNavigate]);

  // Treat app screens as real history entries so Android/iOS back gestures feel native.
  useEffect(() => {
    if (!historyReadyRef.current) {
      window.history.replaceState({ ...window.history.state, fullCircleTab: activeKey }, '', tabUrl(activeKey));
      historyReadyRef.current = true;
      return;
    }
    if (handlingPopStateRef.current) {
      handlingPopStateRef.current = false;
      return;
    }
    if (window.history.state?.fullCircleTab !== activeKey) {
      window.history.pushState({ ...window.history.state, fullCircleTab: activeKey }, '', tabUrl(activeKey));
    }
  }, [activeKey]);

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      const previousTab = event.state?.fullCircleTab;
      if (mobileNavOpen) {
        setMobileNavOpen(false);
        if (typeof previousTab === 'string' && previousTab !== activeKeyRef.current) {
          handlingPopStateRef.current = true;
          onNavigateRef.current(previousTab);
        }
        return;
      }
      if (typeof previousTab === 'string' && previousTab !== activeKeyRef.current) {
        handlingPopStateRef.current = true;
        onNavigateRef.current(previousTab);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [mobileNavOpen]);

  const navigate = (key: string) => {
    onNavigate(key);
    setMobileNavOpen(false);
  };

  useEffect(() => {
    if (!mobileNavOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileNavOpen]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileNavOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, []);

  useEffect(() => {
    const key = `${activeKey} ${headerTitle}`.toLowerCase();
    let mood: SoundMood = 'default';
    if (key.includes('dashboard') || key.includes('home')) mood = 'home';
    else if (key.includes('reading') || key.includes('narrative') || key.includes('devotion')) mood = 'reading';
    else if (key.includes('tent')) mood = 'tent';
    else if (key.includes('arena') || key.includes('daily game') || key.includes('game')) mood = 'game';
    else if (key.includes('quiz')) mood = 'quiz';
    else if (key.includes('streak') || key.includes('challenge board') || key.includes('leaderboard')) mood = 'board';
    else if (key.includes('award')) mood = 'awards';
    else if (key.includes('market') || key.includes('store')) mood = 'market';
    void setSoundscapeMood(mood);
  }, [activeKey, headerTitle]);

  useEffect(() => () => { void stopSoundscape(); }, []);

  useEffect(() => {
    let mounted = true;
    const audience = role === 'instructor' ? 'instructors' : role === 'sentry' ? 'sentries' : 'cadets';
    fetchPanelImageSetting('weekly_background', ['all', audience])
      .then((image) => {
        if (mounted) setWeeklyBackground(image);
      })
      .catch(() => {
        if (mounted) setWeeklyBackground(null);
      });
    return () => {
      mounted = false;
    };
  }, [role]);

  useEffect(() => {
    const playButtonTone = (event: MouseEvent) => {
      const button = (event.target as HTMLElement | null)?.closest('button');
      if (button && !button.disabled) void playInterfaceTone();
    };
    document.addEventListener('click', playButtonTone);
    return () => document.removeEventListener('click', playButtonTone);
  }, []);

  return (
    <div className="relative min-h-screen flex overflow-x-hidden bg-navy">
      {weeklyBackground && (
        <PanelImageBackdrop
          image={weeklyBackground}
          className="fixed z-0"
          imageClassName="weekly-app-background-image"
          veilClassName=""
          opacityFallback={24}
          modeFilter={false}
        />
      )}
      {/* Sidebar */}
      <aside className="fixed left-0 top-0 z-30 hidden h-screen w-60 flex-shrink-0 flex-col border-r border-border bg-navy-2 md:flex">
        <div className="p-5 border-b border-border">
          <div className="flex items-center gap-2.5">
            <DoveMark size={28} />
            <div>
              <h1 className="font-display font-extrabold text-peri text-base leading-none">FULL</h1>
              <p className="text-peri-dim text-xs font-bold tracking-[0.2em] leading-none mt-0.5">CIRCLE</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {navItems.map((item) => (
            <button
              key={item.key}
              onClick={() => navigate(item.key)}
              aria-current={activeKey === item.key ? 'page' : undefined}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold transition-all duration-150',
                activeKey === item.key
                  ? 'bg-navy-4 text-peri border border-border-bright shadow-sm'
                  : 'text-peri-dim hover:bg-navy-3 hover:text-peri',
              )}
            >
              <item.icon size={18} />
              <span className="flex-1 text-left">{item.label}</span>
              {(navBadges[item.key] || 0) > 0 && (
                <span className="notification-badge-ring flex h-5 w-5 items-center justify-center rounded-full border-2 bg-coral p-0 text-[9px] font-bold leading-none text-white shadow-sm">
                  {navBadges[item.key] > 9 ? '9+' : navBadges[item.key]}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="p-3 border-t border-border">
          <div className="flex items-center gap-2.5 px-3 py-2 mb-1">
            <div className="w-8 h-8 rounded-full bg-peri-soft overflow-hidden flex items-center justify-center text-peri font-display font-bold text-sm">
              {profile?.avatar_url ? <img src={profile.avatar_url} alt={profile?.display_name} className="w-full h-full object-cover" /> : (profile?.display_name?.charAt(0).toUpperCase() || '?')}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-peri truncate">{profile?.display_name}</p>
              <p className="text-xs text-peri-dim truncate">{profile?.email}</p>
            </div>
          </div>
          <button onClick={signOut} className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-peri-dim hover:bg-navy-3 hover:text-peri transition-colors font-bold">
            <LogOut size={16} /> Sign Out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="relative z-10 flex-1 flex flex-col min-w-0 md:ml-60">
        <header className="app-safe-header sticky top-0 z-30 border-b border-border bg-navy-2 px-3 py-2 shadow-sm sm:px-4 sm:py-3 md:px-6">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-3">
            <div className="flex min-w-0 items-start justify-between gap-2 md:flex-1">
              <div className="flex min-w-0 items-start gap-2">
                <button
                  onClick={() => setMobileNavOpen((open) => !open)}
                  className="md:hidden inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl border border-border bg-navy-3 text-peri-dim shadow-sm hover:text-peri"
                  aria-label={mobileNavOpen ? 'Close dashboard menu' : 'Open dashboard menu'}
                >
                  {mobileNavOpen ? <X size={20} /> : <Menu size={20} />}
                </button>
                <div className="min-w-0 pt-0.5">
                  <h2 className="font-display font-extrabold text-peri text-base leading-tight truncate md:text-lg">{headerTitle}</h2>
                  {headerSubtitle && <p className="hidden text-xs text-peri-dim truncate font-medium sm:block">{headerSubtitle}</p>}
                </div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-2 md:hidden">
                <SoundToggle />
                <ThemeToggle />
                {showTopSignOut && (
                  <button
                    onClick={signOut}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-navy-3 text-peri-dim transition-all hover:border-border-bright hover:bg-coral-soft hover:text-coral"
                    title="Sign out"
                  >
                    <LogOut size={16} />
                  </button>
                )}
              </div>
            </div>
            <div className="flex max-w-full items-center gap-2 overflow-x-auto overscroll-x-contain pb-1 pt-2 md:flex-shrink-0 md:justify-end md:overflow-visible md:py-0">
              <div className="hidden md:block">
                <ThemeToggle />
              </div>
              <div className="hidden md:block">
                <SoundToggle />
              </div>
              {showTopSignOut && (
                <button
                  onClick={signOut}
                  className="hidden h-9 w-9 items-center justify-center rounded-xl border border-border bg-navy-3 text-peri-dim transition-all hover:border-border-bright hover:bg-coral-soft hover:text-coral md:inline-flex"
                  title="Sign out"
                >
                  <LogOut size={16} />
                </button>
              )}
              {rightHeader}
            </div>
          </div>
        </header>

        {/* Mobile side dashboard */}
        <div
          className={cn(
            'md:hidden fixed inset-0 z-40 transition-opacity duration-300',
            mobileNavOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
          )}
        >
          <button
            type="button"
            className="absolute inset-0 bg-ink/45"
            onClick={() => setMobileNavOpen(false)}
            aria-label="Close dashboard menu"
          />
          <aside
            className={cn(
              'safe-area-top safe-area-left safe-area-bottom absolute left-0 top-0 h-full w-[86vw] max-w-[340px] border-r border-border bg-navy-2 shadow-2xl transition-transform duration-300 ease-out',
              mobileNavOpen ? 'translate-x-0' : '-translate-x-full',
            )}
          >
            <div className="flex items-center justify-between border-b border-border p-4">
              <div className="flex items-center gap-2.5">
                <DoveMark size={28} />
                <div>
                  <h1 className="font-display font-extrabold text-peri text-base leading-none">FULL</h1>
                  <p className="text-peri-dim text-xs font-bold tracking-[0.2em] leading-none mt-0.5">CIRCLE</p>
                </div>
              </div>
              <button
                onClick={() => setMobileNavOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-navy-3 text-peri-dim hover:text-peri"
                aria-label="Close dashboard menu"
              >
                <X size={16} />
              </button>
            </div>

            <nav className="h-[calc(100%-150px)] overflow-y-auto overscroll-contain p-3 space-y-1">
              {navItems.map((item) => (
                <button
                  key={item.key}
                  onClick={() => navigate(item.key)}
                  aria-current={activeKey === item.key ? 'page' : undefined}
                  className={cn(
                    'relative flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-bold transition-all',
                    activeKey === item.key
                      ? 'bg-navy-4 text-peri border border-border-bright shadow-sm'
                      : 'text-peri-dim hover:bg-navy-3 hover:text-peri',
                  )}
                >
                  <item.icon size={18} />
                  <span className="flex-1 text-left truncate">{item.label}</span>
                  {(navBadges[item.key] || 0) > 0 && (
                    <span className="notification-badge-ring flex h-5 w-5 items-center justify-center rounded-full border-2 bg-coral p-0 text-[9px] font-bold leading-none text-white shadow-sm">
                      {navBadges[item.key] > 9 ? '9+' : navBadges[item.key]}
                    </span>
                  )}
                </button>
              ))}
            </nav>

            <div className="border-t border-border p-3">
              <div className="flex items-center gap-2.5 rounded-xl bg-navy-3 px-3 py-2">
                <div className="w-8 h-8 rounded-full bg-peri-soft overflow-hidden flex items-center justify-center text-peri font-display font-bold text-sm">
                  {profile?.avatar_url ? <img src={profile.avatar_url} alt={profile?.display_name} className="w-full h-full object-cover" /> : (profile?.display_name?.charAt(0).toUpperCase() || '?')}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-peri truncate">{profile?.display_name}</p>
                  <p className="text-xs text-peri-dim truncate">{profile?.email}</p>
                </div>
              </div>
            </div>
          </aside>
        </div>

        <main className="flex-1 w-full max-w-6xl mx-auto px-3 py-4 sm:px-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}

export function StatCard({ icon: Icon, label, value, sublabel, color }: {
  icon: ElementType; label: string; value: ReactNode; sublabel?: string; color?: string;
}) {
  return (
    <div className="card p-4 card-hover">
      <div className="flex items-start justify-between">
        <div>
          <p className="eyebrow">{label}</p>
          <p className="font-display text-2xl font-extrabold text-peri mt-1">{value}</p>
          {sublabel && <p className="text-xs text-peri-dim mt-0.5 font-medium">{sublabel}</p>}
        </div>
        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${color || '#DDE3FF'}15` }}>
          <Icon size={20} color={color || '#DDE3FF'} />
        </div>
      </div>
    </div>
  );
}

export function SectionHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4 mb-3">
      <div>
        <h3 className="font-display font-bold text-peri text-lg">{title}</h3>
        {subtitle && <p className="text-sm text-peri-dim font-medium">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, message }: { icon: ElementType; title: string; message: string }) {
  return (
    <div className="card p-8 text-center">
      <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-navy-3 mb-3">
        <Icon size={24} className="text-peri-dim" />
      </div>
      <h3 className="font-display font-bold text-peri mb-1">{title}</h3>
      <p className="text-sm text-peri-dim max-w-sm mx-auto">{message}</p>
    </div>
  );
}
