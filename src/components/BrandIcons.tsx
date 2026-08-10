/**
 * Brand icon set — exact matches to the Canva branding.
 * All icons are filled (not outline), matching the branding board style.
 * Each icon uses currentColor for fills so it can be tinted via text color.
 */

interface IconProps {
  size?: number;
  className?: string;
}

const base = (size: number) => ({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none' });

// ── Open book (readings / narrative) ──
export function BookIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <path d="M12 6 C10 5 6 4 3 4 V19 C6 19 10 20 12 21 C14 20 18 19 21 19 V4 C18 4 14 5 12 6 Z" fill="currentColor" />
      <path d="M12 6 C10 5 6 4 3 4 V19 C6 19 10 20 12 21 Z" fill="currentColor" opacity="0.75" />
      <line x1="12" y1="6" x2="12" y2="21" stroke="rgba(0,0,0,0.15)" strokeWidth="0.8" />
    </svg>
  );
}

// ── Game controller (daily game) ──
export function GamepadIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <path d="M6 8 H18 C20 8 22 10 22 13 V15 C22 17 21 18 19.5 18 C18.5 18 18 17 17.5 16 L17 15 H7 L6.5 16 C6 17 5.5 18 4.5 18 C3 18 2 17 2 15 V13 C2 10 4 8 6 8 Z" fill="currentColor" />
      <rect x="5.5" y="12" width="3" height="1.5" rx="0.5" fill="rgba(0,0,0,0.3)" />
      <rect x="6.25" y="11.25" width="1.5" height="3" rx="0.5" fill="rgba(0,0,0,0.3)" />
      <circle cx="15" cy="12.5" r="1.2" fill="rgba(0,0,0,0.3)" />
      <circle cx="17.5" cy="14" r="1.2" fill="rgba(0,0,0,0.3)" />
    </svg>
  );
}

// ── Trophy (leaderboard / awards) ──
export function TrophyIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <path d="M7 4 H17 V8 C17 11 15 13 12 13 C9 13 7 11 7 8 V4 Z" fill="currentColor" />
      <path d="M5 5 C3 5 2 6 2 7.5 C2 9 3 10 5 10 L5.5 10 C5.2 9 5 8 5 7 V5 Z" fill="currentColor" />
      <path d="M19 5 C21 5 22 6 22 7.5 C22 9 21 10 19 10 L18.5 10 C18.8 9 19 8 19 7 V5 Z" fill="currentColor" />
      <rect x="10" y="13" width="4" height="4" fill="currentColor" />
      <path d="M8 17 H16 L17 20 H7 L8 17 Z" fill="currentColor" />
    </svg>
  );
}

// ── Quiz card with ? (quiz) ──
export function QuizIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <path d="M5 3 H14 L19 8 V21 H5 Z" fill="currentColor" />
      <path d="M14 3 L19 8 H14 V3 Z" fill="currentColor" opacity="0.6" />
      <text x="12" y="17" textAnchor="middle" fontSize="9" fontWeight="900" fill="rgba(0,0,0,0.4)" fontFamily="sans-serif">?</text>
    </svg>
  );
}

// ── Streak flame (streak) ──
export function FlameIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <path d="M12 2 C10 6 7 8 7 12 C7 16 9 19 12 20 C15 19 17 16 17 12 C17 8 14 6 12 2 Z" fill="currentColor" />
      <path d="M12 10 C11 12 10 13 10 15 C10 17 11 18 12 19 C13 18 14 17 14 15 C14 13 13 12 12 10 Z" fill="rgba(0,0,0,0.15)" />
    </svg>
  );
}

// ── Coin with profile (denarii) ──
export function CoinIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <circle cx="12" cy="12" r="10" fill="currentColor" />
      <circle cx="12" cy="12" r="8.5" fill="none" stroke="rgba(0,0,0,0.2)" strokeWidth="0.8" />
      <circle cx="10" cy="12" r="3.5" fill="rgba(0,0,0,0.15)" />
      <path d="M10 9.5 Q13 11 13 12 Q13 13 10 14.5" stroke="rgba(0,0,0,0.12)" strokeWidth="0.6" fill="none" />
    </svg>
  );
}

// ── Tent (tents) ──
export function TentIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <path d="M12 4 L3 20 H21 L12 4 Z" fill="currentColor" />
      <path d="M12 4 L12 20 L3 20 L12 4 Z" fill="currentColor" opacity="0.75" />
      <path d="M12 12 L9 20 H15 L12 12 Z" fill="rgba(0,0,0,0.12)" />
    </svg>
  );
}

// ── Sentry (person with star) ──
export function SentryIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <circle cx="10" cy="7" r="4" fill="currentColor" />
      <path d="M3 21 C3 16 6 13 10 13 C14 13 17 16 17 21 H3 Z" fill="currentColor" />
      <path d="M17 3 L18 6 L21 6.5 L18.8 8.5 L19.5 11.5 L17 10 L14.5 11.5 L15.2 8.5 L13 6.5 L16 6 L17 3 Z" fill="currentColor" />
    </svg>
  );
}

// ── Cadet (plain person) ──
export function CadetIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <circle cx="12" cy="7" r="4" fill="currentColor" />
      <path d="M4 21 C4 16 7 13 12 13 C17 13 20 16 20 21 H4 Z" fill="currentColor" />
    </svg>
  );
}

// ── Instructor (person at podium) ──
export function InstructorIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <circle cx="9" cy="5" r="3.5" fill="currentColor" />
      <path d="M3 14 C3 10 5 8 9 8 C13 8 15 10 15 14 V15 H3 Z" fill="currentColor" />
      <path d="M5 15 H13 V22 H5 Z" fill="currentColor" />
      <path d="M13 16 H21 V20 H13 Z" fill="currentColor" opacity="0.7" />
    </svg>
  );
}

// ── Dashboard/Home ──
export function DashboardIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <rect x="3" y="3" width="8" height="8" rx="2" fill="currentColor" />
      <rect x="13" y="3" width="8" height="5" rx="2" fill="currentColor" />
      <rect x="13" y="10" width="8" height="11" rx="2" fill="currentColor" opacity="0.7" />
      <rect x="3" y="13" width="8" height="8" rx="2" fill="currentColor" opacity="0.7" />
    </svg>
  );
}

// ── Settings (gear) ──
export function SettingsIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <path d="M12 2 L13.5 5 L16.5 4 L17 7 L20 8 L18.5 11 L20 14 L17 15 L16.5 18 L13.5 17 L12 20 L10.5 17 L7.5 18 L7 15 L4 14 L5.5 11 L4 8 L7 7 L7.5 4 L10.5 5 Z" fill="currentColor" />
      <circle cx="12" cy="11" r="3" fill="rgba(0,0,0,0.25)" />
    </svg>
  );
}

// ── Calendar ──
export function CalendarIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <rect x="3" y="5" width="18" height="16" rx="3" fill="currentColor" />
      <rect x="3" y="5" width="18" height="5" rx="3" fill="currentColor" />
      <rect x="6" y="3" width="2.5" height="4" rx="1" fill="currentColor" />
      <rect x="15.5" y="3" width="2.5" height="4" rx="1" fill="currentColor" />
      <rect x="7" y="12" width="3" height="3" rx="1" fill="rgba(0,0,0,0.2)" />
      <rect x="14" y="12" width="3" height="3" rx="1" fill="rgba(0,0,0,0.2)" />
    </svg>
  );
}

// ── Tent house: Squares (3D cube) ──
export function HouseSquareIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <path d="M12 3 L21 8 L12 13 L3 8 L12 3 Z" fill="currentColor" />
      <path d="M3 8 L12 13 V21 L3 16 V8 Z" fill="currentColor" opacity="0.8" />
      <path d="M21 8 L12 13 V21 L21 16 V8 Z" fill="currentColor" opacity="0.6" />
    </svg>
  );
}

// ── Tent house: Spades (card suit spade) ──
export function HouseSpadeIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <path d="M12 2 C9 6 4 9 4 13 C4 15 6 16 8 16 C9 16 10 15.5 11 15 L10 20 H14 L13 15 C14 15.5 15 16 16 16 C18 16 20 15 20 13 C20 9 15 6 12 2 Z" fill="currentColor" />
    </svg>
  );
}

// ── Tent house: Rudes (sword) ──
export function HouseSwordIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <path d="M14 2 L18 6 L8 16 L4 20 L5 16 L14 2 Z" fill="currentColor" />
      <rect x="15" y="15" width="7" height="2.5" rx="1" transform="rotate(-45 15 15)" fill="currentColor" />
      <rect x="16.5" y="17" width="3" height="6" rx="1" transform="rotate(-45 16.5 17)" fill="currentColor" opacity="0.7" />
    </svg>
  );
}

// ── Tent house: Darics (Greek/Roman column — the gold standard) ──
export function HouseCoinIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      {/* Pediment / roof */}
      <path d="M4 7 L12 3 L20 7 Z" fill="currentColor" />
      {/* Architrave beam */}
      <rect x="4" y="7" width="16" height="2" rx="0.5" fill="currentColor" opacity="0.85" />
      {/* Three columns */}
      <rect x="5" y="9.5" width="2.5" height="9" rx="0.5" fill="currentColor" />
      <rect x="10.75" y="9.5" width="2.5" height="9" rx="0.5" fill="currentColor" />
      <rect x="16.5" y="9.5" width="2.5" height="9" rx="0.5" fill="currentColor" />
      {/* Base */}
      <rect x="3.5" y="18.5" width="17" height="2.5" rx="0.5" fill="currentColor" opacity="0.85" />
    </svg>
  );
}

// ── Tent house: Laureats (laurel wreath) ──
export function HouseLaurelIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <path d="M12 3 C7 3 4 6 4 11 C4 15 6 18 9 20" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M12 3 C17 3 20 6 20 11 C20 15 18 18 15 20" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <ellipse cx="7" cy="9" rx="2.5" ry="1.5" fill="currentColor" transform="rotate(-30 7 9)" />
      <ellipse cx="6" cy="13" rx="2.5" ry="1.5" fill="currentColor" transform="rotate(-45 6 13)" />
      <ellipse cx="8" cy="17" rx="2" ry="1.2" fill="currentColor" transform="rotate(-60 8 17)" />
      <ellipse cx="17" cy="9" rx="2.5" ry="1.5" fill="currentColor" transform="rotate(30 17 9)" />
      <ellipse cx="18" cy="13" rx="2.5" ry="1.5" fill="currentColor" transform="rotate(45 18 13)" />
      <ellipse cx="16" cy="17" rx="2" ry="1.2" fill="currentColor" transform="rotate(60 16 17)" />
    </svg>
  );
}

// ── Award/medal ──
export function AwardIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <circle cx="12" cy="14" r="7" fill="currentColor" />
      <path d="M8 3 H16 L14 8 H10 L8 3 Z" fill="currentColor" />
      <circle cx="12" cy="14" r="4" fill="rgba(0,0,0,0.18)" />
      <text x="12" y="17" textAnchor="middle" fontSize="6" fontWeight="900" fill="rgba(255,255,255,0.5)" fontFamily="sans-serif">1</text>
    </svg>
  );
}

// ── Users/people ──
export function UsersIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <circle cx="9" cy="7" r="3.5" fill="currentColor" />
      <path d="M2 20 C2 16 5 13 9 13 C13 13 16 16 16 20 H2 Z" fill="currentColor" />
      <circle cx="17" cy="8" r="2.5" fill="currentColor" opacity="0.6" />
      <path d="M15 20 C15 17 17 15 19 15 C21 15 22 17 22 20 H15 Z" fill="currentColor" opacity="0.6" />
    </svg>
  );
}

// ── Bell (announcements) ──
export function BellIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <path d="M12 2 C10 2 9 3 9 5 C6 6 5 9 5 13 C5 16 4 17 3 18 H21 C20 17 19 16 19 13 C19 9 18 6 15 5 C15 3 14 2 12 2 Z" fill="currentColor" />
      <path d="M10 19 C10 21 11 22 12 22 C13 22 14 21 14 19 H10 Z" fill="currentColor" />
    </svg>
  );
}
