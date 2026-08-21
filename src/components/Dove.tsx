import { cn } from '../lib/utils';
import doveArtwork from '../assets/brand-real/dove-clean.png';

const stableDoveArtwork = '/icons/fullcircle-dove-clean.png';

/**
 * Dove — the supplied Full Circle dove artwork, including its cloud.
 */
export function Dove({ size = 120, className }: {
  size?: number;
  className?: string;
}) {
  return (
    <img
      src={stableDoveArtwork}
      width={size}
      height={size}
      className={cn('block object-contain', className)}
      alt="Full Circle dove"
      loading="eager"
      decoding="sync"
      onError={(event) => {
        if (event.currentTarget.dataset.fallbackLoaded === 'true') return;
        event.currentTarget.dataset.fallbackLoaded = 'true';
        event.currentTarget.src = doveArtwork;
      }}
    />
  );
}

/**
 * DoveMark — compact transparent dove for navigation and branding.
 */
export function DoveMark({ size = 44, className }: { size?: number; className?: string }) {
  return (
    <div
      className={cn('inline-flex items-center justify-center flex-shrink-0', className)}
      style={{ width: size, height: size }}
    >
      <Dove size={size} />
    </div>
  );
}

/**
 * FullCircleWordmark — compact brand text using the app's standard typeface.
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
        style={{ fontFamily: 'Nunito, system-ui, sans-serif', fontWeight: 800, letterSpacing: '0.01em', color: color || 'var(--color-peri)' }}
      >
        FULL
      </span>
      <span
        className={cn('font-display font-bold text-peri', circleSizes[size])}
        style={{
          fontFamily: 'Nunito, system-ui, sans-serif',
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
