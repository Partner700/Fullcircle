import { cn } from '../lib/utils';
import doveAsset from '../assets/brand-real/dove.png';

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
    <img
      src={doveAsset}
      alt="Full Circle dove"
      width={size}
      height={size}
      className={cn('object-contain', className)}
      style={{ width: size, height: size }}
    />
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
