import { type ReactNode, useState, useEffect, useCallback } from 'react';
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
      className="inline-flex items-center justify-center w-9 h-9 rounded-xl border border-border bg-navy-3 text-peri-dim hover:text-peri hover:border-border-bright transition-all"
      title={theme === 'night' ? 'Switch to day mode' : 'Switch to night mode'}
    >
      {theme === 'night' ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}

interface NavItem {
  key: string;
  label: string;
  icon: typeof DoveMark;
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

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 md:ml-0">
        <header className="sticky top-0 z-20 bg-navy-2 border-b border-border px-4 md:px-6 py-3">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setMobileNavOpen((open) => !open)}
                  className="md:hidden inline-flex items-center justify-center w-9 h-9 rounded-xl border border-border bg-navy-3 text-peri-dim hover:text-peri"
                  aria-label={mobileNavOpen ? 'Close dashboard menu' : 'Open dashboard menu'}
                >
                  {mobileNavOpen ? <X size={16} /> : <Menu size={16} />}
                </button>
                <h2 className="font-display font-extrabold text-peri text-lg leading-tight truncate">{headerTitle}</h2>
              </div>
              {headerSubtitle && <p className="text-xs text-peri-dim truncate font-medium">{headerSubtitle}</p>}
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              <ThemeToggle />
              {showTopSignOut && (
                <button
                  onClick={signOut}
                  className="inline-flex items-center justify-center w-9 h-9 rounded-xl border border-border bg-navy-3 text-peri-dim hover:text-coral hover:border-border-bright hover:bg-coral-soft transition-all"
                  title="Sign out"
                >
                  <LogOut size={16} />
                </button>
              )}
              {rightHeader}
            </div>
          </div>
          {/* Mobile nav */}
          {mobileNavOpen && <div className="md:hidden fixed inset-0 top-[68px] bg-ink/35 z-10" onClick={() => setMobileNavOpen(false)} />}
          {mobileNavOpen && <div className="md:hidden relative z-20 grid grid-cols-2 gap-2 mt-3 rounded-xl border border-border bg-navy-2 p-2 shadow-lg animate-fade-in">
            {navItems.map((item) => (
              <button
                key={item.key}
                onClick={() => navigate(item.key)}
                aria-current={activeKey === item.key ? 'page' : undefined}
                className={cn(
                  'relative flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold whitespace-nowrap transition-all',
                  activeKey === item.key ? 'bg-navy-4 text-peri border border-border-bright' : 'text-peri-dim bg-navy-3',
                )}
              >
                <item.icon size={14} />
                <span className="truncate">{item.label}</span>
                {(navBadges[item.key] || 0) > 0 && (
                  <span className="ml-auto min-w-5 h-5 px-1 rounded-full bg-coral text-white text-[10px] font-bold flex items-center justify-center">
                    {navBadges[item.key] > 9 ? '9+' : navBadges[item.key]}
                  </span>
                )}
              </button>
            ))}
          </div>}
        </header>

        <main className="flex-1 p-4 md:p-6 max-w-6xl mx-auto w-full">{children}</main>
      </div>
    </div>
  );
}

export function StatCard({ icon: Icon, label, value, sublabel, color }: {
  icon: React.ComponentType<{ size?: string | number; color?: string; className?: string }>; label: string; value: ReactNode; sublabel?: string; color?: string;
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

export function EmptyState({ icon: Icon, title, message }: { icon: typeof DoveMark; title: string; message: string }) {
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
