import type { ReactNode } from 'react';
import type { PanelImageSetting } from '../lib/types';
import { cn } from '../lib/utils';
import { PanelImageBackdrop } from './PanelImageBackdrop';

/** Shared artwork treatment for every Challenge Board and its ranking cards. */
export function ChallengeBoardPanel({ image, children, className = 'p-4' }: { image: PanelImageSetting | null; children: ReactNode; className?: string }) {
  return <div data-artwork-theme={image?.url ? 'night' : undefined} className={cn('card relative overflow-hidden', className)}>
    <PanelImageBackdrop image={image} opacityFallback={100} veilClassName="welcome-slide-veil" modeFilter={false} textGradient={false} />
    <div className="relative z-10">{children}</div>
  </div>;
}
