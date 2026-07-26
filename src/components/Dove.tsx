import { cn } from '../lib/utils';

/**
 * Dove — exact SVG replica of the branding illustration.
 * White circle head, dark navy eye, tan beak, white body,
 * slate-blue back wing, blue foot, small cloud.
 */
export function Dove({ size = 120, className }: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn(className)}
      aria-label="Full Circle dove"
    >
      {/* Cloud — upper right */}
      <ellipse cx="88" cy="18" rx="14" ry="9" fill="#B5C0D8" />
      <ellipse cx="78" cy="22" rx="9" ry="6" fill="#B5C0D8" />
      <ellipse cx="98" cy="23" rx="7" ry="5" fill="#B5C0D8" />

      {/* Back wing — slate blue, curving down behind body */}
      <path
        d="M58 50 Q72 45 78 55 Q82 68 72 78 Q62 80 54 72 Q50 60 58 50 Z"
        fill="#4A6B9E"
      />
      <path
        d="M62 55 Q70 52 74 60 Q76 68 70 73 Q63 74 58 69 Q56 62 62 55 Z"
        fill="#3A5680"
        opacity="0.6"
      />

      {/* Body — white, round */}
      <ellipse cx="55" cy="65" rx="22" ry="18" fill="#FFFFFF" />

      {/* Head — white circle */}
      <circle cx="40" cy="42" r="14" fill="#FFFFFF" />

      {/* Eye — dark navy, D-shape (open eye) */}
      <path
        d="M38 36 Q43 36 43 41 Q43 44 40 44 Q36 44 36 41 Q36 36 38 36 Z"
        fill="#1A2438"
      />
      {/* Tiny eye highlight */}
      <circle cx="41" cy="39" r="1.5" fill="#FFFFFF" />

      {/* Beak — tan, triangular, pointing left */}
      <path
        d="M28 44 L22 46 L28 49 Z"
        fill="#D4A05A"
      />
      <path
        d="M28 44 L22 46 L28 49 Z"
        fill="none"
        stroke="#B88540"
        strokeWidth="0.5"
      />

      {/* Raised front wing — white, arc above body */}
      <path
        d="M45 52 Q48 38 60 36 Q70 38 68 48 Q60 54 50 56 Q44 56 45 52 Z"
        fill="#FFFFFF"
      />
      {/* Wing edge detail */}
      <path
        d="M48 52 Q52 42 60 40 Q66 42 64 48"
        stroke="#D0D8E8"
        strokeWidth="1"
        fill="none"
      />

      {/* Belly — slight gray shadow on body */}
      <ellipse cx="60" cy="72" rx="14" ry="10" fill="#E8EDF5" opacity="0.6" />

      {/* Foot — small blue stub */}
      <rect x="52" y="80" width="4" height="8" rx="1" fill="#4A6B9E" />
      <path d="M50 88 L58 88 L54 90 Z" fill="#3A5680" />

      {/* Bottom — tiny second foot shadow */}
      <ellipse cx="62" cy="84" rx="3" ry="2" fill="#3A5680" opacity="0.4" />
    </svg>
  );
}

/**
 * DoveMark — compact dove for nav/sidebar. Uses the SVG dove in a rounded tile.
 */
export function DoveMark({ size = 44, className }: { size?: number; className?: string }) {
  return (
    <div
      className={cn('inline-flex items-center justify-center rounded-2xl flex-shrink-0', className)}
      style={{ width: size, height: size, background: 'var(--color-peri)', borderRadius: 14 }}
    >
      <Dove size={size * 0.82} />
    </div>
  );
}

/**
 * FullCircleWordmark — "FULL CIRCLE" wordmark matching the branding.
 * Uses Baloo 2 ExtraBold (800) for the chunky rounded letterforms.
 */
export function FullCircleWordmark({ size = 'md', className, color }: {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  color?: string;
}) {
  const fullSizes = { sm: 'text-3xl', md: 'text-5xl', lg: 'text-7xl' };
  const circleSizes = { sm: 'text-[10px]', md: 'text-xs', lg: 'text-sm' };
  const circleSpacing = { sm: '0.35em', md: '0.38em', lg: '0.4em' };

  return (
    <div className={cn('flex flex-col items-center leading-none', className)}>
      <span
        className={cn('font-display font-extrabold text-peri', fullSizes[size])}
        style={{ fontFamily: '"Baloo 2", system-ui', fontWeight: 800, letterSpacing: '0.01em', color: color || 'var(--color-peri)' }}
      >
        FULL
      </span>
      <span
        className={cn('font-display font-bold text-peri', circleSizes[size])}
        style={{
          fontFamily: '"Baloo 2", system-ui',
          fontWeight: 600,
          letterSpacing: circleSpacing[size],
          marginTop: size === 'lg' ? '2px' : '0px',
          color: color || 'var(--color-peri)',
        }}
      >
        CIRCLE
      </span>
    </div>
  );
}
