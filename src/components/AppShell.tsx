import { type ElementType, type ReactNode, useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { cn } from '../lib/utils';
import { DoveMark } from './Dove';
import { LogOut, Sun, Moon, Menu, X } from 'lucide-react';

type Theme = 'night' | 'day';

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
      className="inline-flex items-center justify-center w-10 h-10 sm:w-9 sm:h-9 rounded-xl border border-border bg-navy-3 text-peri-dim hover:text-peri hover:border-border-bright transition-all"
      title={theme === 'night' ? 'Switch to day mode' : 'Switch to night mode'}
    >
      {theme === 'night' ? <Sun size={16} /> : <Moon size={16} />}
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
  const { profile, signOut } = useAuth();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

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

  return (
    <div className="min-h-screen flex bg-navy">
      {/* Sidebar */}
      <aside className="w-60 flex-shrink-0 border-r border-border bg-navy-2 flex flex-col fixed lg:sticky top-0 h-screen z-30 hidden md:flex">
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
                <span className="min-w-5 h-5 px-1 rounded-full bg-coral text-white text-[10px] font-bold flex items-center justify-center">
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

      {/* Mobile navigation drawer */}
      {mobileNavOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          <button
            type="button"
            className="absolute inset-0 bg-black/55 backdrop-blur-[1px]"
            onClick={() => setMobileNavOpen(false)}
            aria-label="Close dashboard menu"
          />
          <aside className="absolute inset-y-0 left-0 flex w-[min(86vw,21rem)] flex-col border-r border-border bg-navy-2 shadow-2xl animate-slide-in-left">
            <div className="flex min-h-16 items-center justify-between gap-3 border-b border-border px-4">
              <div className="flex items-center gap-2.5">
                <DoveMark size={30} />
                <div>
                  <h1 className="font-display text-base font-extrabold leading-none text-peri">FULL</h1>
                  <p className="mt-0.5 text-xs font-bold leading-none tracking-[0.2em] text-peri-dim">CIRCLE</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-navy-3 text-peri"
                aria-label="Close dashboard menu"
              >
                <X size={20} />
              </button>
            </div>

            <nav className="flex-1 space-y-1.5 overflow-y-auto p-3">
              {navItems.map((item) => (
                <button
                  key={item.key}
                  onClick={() => navigate(item.key)}
                  aria-current={activeKey === item.key ? 'page' : undefined}
                  className={cn(
                    'relative flex min-h-12 w-full items-center gap-3 rounded-lg px-3.5 py-3 text-left text-sm font-bold transition-all',
                    activeKey === item.key
                      ? 'border border-border-bright bg-navy-4 text-peri shadow-sm'
                      : 'border border-transparent text-peri-dim hover:bg-navy-3 hover:text-peri',
                  )}
                >
                  <item.icon size={20} />
                  <span className="min-w-0 flex-1">{item.label}</span>
                  {(navBadges[item.key] || 0) > 0 && (
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-coral px-1 text-[10px] font-bold text-white">
                      {navBadges[item.key] > 9 ? '9+' : navBadges[item.key]}
                    </span>
                  )}
                </button>
              ))}
            </nav>

            <div className="border-t border-border p-3">
              <div className="mb-2 flex items-center gap-3 rounded-lg bg-navy-3 px-3 py-3">
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-peri-soft text-sm font-bold text-peri">
                  {profile?.avatar_url ? <img src={profile.avatar_url} alt={profile?.display_name} className="h-full w-full object-cover" /> : (profile?.display_name?.charAt(0).toUpperCase() || '?')}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-peri">{profile?.display_name}</p>
                  <p className="truncate text-xs text-peri-dim">{profile?.email}</p>
                </div>
              </div>
              <button onClick={signOut} className="flex min-h-12 w-full items-center gap-2 rounded-lg px-3 py-3 text-sm font-bold text-peri-dim transition-colors hover:bg-navy-3 hover:text-peri">
                <LogOut size={18} /> Sign Out
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 md:ml-0">
        <header className="sticky top-0 z-20 border-b border-border bg-navy-2 px-3 py-2.5 sm:px-4 sm:py-3 md:px-6">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setMobileNavOpen((open) => !open)}
                  className="md:hidden inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-border bg-navy-3 text-peri hover:border-border-bright"
                  aria-label={mobileNavOpen ? 'Close dashboard menu' : 'Open dashboard menu'}
                >
                  {mobileNavOpen ? <X size={20} /> : <Menu size={20} />}
                </button>
                <h2 className="truncate font-display text-base font-extrabold leading-tight text-peri sm:text-lg">{headerTitle}</h2>
              </div>
              {headerSubtitle && <p className="ml-[3.25rem] truncate text-xs font-medium text-peri-dim md:ml-0">{headerSubtitle}</p>}
            </div>
            <div className="order-2 flex w-full flex-shrink-0 items-center justify-end gap-2 overflow-x-auto pb-0.5 sm:order-none sm:w-auto sm:overflow-visible sm:pb-0">
              <ThemeToggle />
              {showTopSignOut && (
                <button
                  onClick={signOut}
                  className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-border bg-navy-3 text-peri-dim transition-all hover:border-border-bright hover:bg-coral-soft hover:text-coral sm:h-9 sm:w-9"
                  title="Sign out"
                >
                  <LogOut size={16} />
                </button>
              )}
              {rightHeader}
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 p-3 sm:p-4 md:p-6">{children}</main>
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
    <div className="mb-3 flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-end sm:gap-4">
      <div className="min-w-0">
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
