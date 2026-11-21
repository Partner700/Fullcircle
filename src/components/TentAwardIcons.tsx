import { forwardRef } from 'react';
import type { LucideProps } from 'lucide-react';

const OIL_GOLD = '#B88A18';

/** Seven-branched menorah, the annual Lumen Domus honor. */
export const LumenDomusIcon = forwardRef<SVGSVGElement, LucideProps>(function LumenDomusIcon({ size = 24, color = 'currentColor', strokeWidth = 2, ...props }, ref) {
  return <svg ref={ref} width={size} height={size} viewBox="0 0 48 48" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <path d="M24 12v29M14 42h20M19 39h10M6 14v3c0 10 8 16 18 16s18-6 18-16v-3M12 14v3c0 7 5 11 12 11s12-4 12-11v-3M18 14v3c0 4 2 6 6 6s6-2 6-6v-3" strokeWidth={2.5}/>
    {[6,12,18,24,30,36,42].map(x => <path key={x} d={`M${x} 3c-1.5 3-2.5 4-2.5 6a2.5 2.5 0 0 0 5 0c0-2-1-3-2.5-6Z`} fill={OIL_GOLD} stroke="none"/>)}
    {[6,12,18,24,30,36,42].map(x => <path key={x} d={`M${x-2} 13h4`} strokeWidth={2}/>)}
  </svg>;
});

/** Jacob's stone, with its upper half covered in dark golden oil. */
export const BethelStoneIcon = forwardRef<SVGSVGElement, LucideProps>(function BethelStoneIcon({ size = 24, color = 'currentColor', strokeWidth = 2, ...props }, ref) {
  return <svg ref={ref} width={size} height={size} viewBox="0 0 48 48" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <path d="M7 24 10 16 18 8 33 9 41 18 42 24 37 37 27 41 13 38 6 31Z" fill="#777D80" stroke="none" />
    <path d="M7 24 10 16 18 8 33 9 41 18 42 24Z" fill={OIL_GOLD} stroke="none" />
    <path d="M7 24 10 16 18 8 33 9 41 18 42 24 37 37 27 41 13 38 6 31Z" stroke={color} strokeWidth="2" />
    <path d="m7 24 35 0M13 38l5-14m15 0 4 13M18 8l1 16" stroke={color} opacity=".45" />
  </svg>;
});

/** Two separate pillars, each bearing a flame — the weekly Temple honor. */
export const TempleIcon = forwardRef<SVGSVGElement, LucideProps>(function TempleIcon({ size = 24, color = 'currentColor', strokeWidth = 2, ...props }, ref) {
  return <svg ref={ref} width={size} height={size} viewBox="0 0 48 48" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    {[13,35].map(x => <g key={x}>
      <path d={`M${x} 3c.7 4-3.5 4.5-4.5 8a4.7 4.7 0 0 0 9 1c.7-3-2-5-4.5-9Z`} fill={OIL_GOLD} stroke="none" />
      <path d={`M${x-8} 18h16v4h-16zM${x-5} 22v17h10V22M${x-8} 39h16v4h-16z`} strokeWidth="2"/>
      <path d={`M${x} 25v11`} strokeWidth="1.5" opacity=".75"/>
    </g>)}
  </svg>;
});
