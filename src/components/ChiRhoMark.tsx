import laurels from '../assets/brand-real/laureats.png';
import { publicAsset } from '../lib/publicAsset';

export function ChiRhoMark({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <span
      className={`fc-chi-rho-mark relative inline-flex shrink-0 items-center justify-center ${className}`}
      style={{ width: size, height: size }}
      aria-label="Labarum"
      title="Labarum"
    >
      <span
        className="fc-chi-rho-fallback font-serif font-black leading-none"
        style={{ fontSize: Math.max(10, Math.round(size * 1.05)) }}
        aria-hidden="true"
      >
        ☧
      </span>
      <span
        className="fc-chi-rho-mask absolute inset-0 bg-current"
        style={{
          WebkitMask: `url(${publicAsset('labarum-mark.png')}) center / contain no-repeat`,
          mask: `url(${publicAsset('labarum-mark.png')}) center / contain no-repeat`,
        }}
        aria-hidden="true"
      />
    </span>
  );
}

export function GrandVallumMark({ size = 24, className = '' }: { size?: number; className?: string }) {
  const width = Math.round(size * 1.2);
  return (
    <span className={`relative inline-flex shrink-0 items-center justify-center ${className}`} style={{ width, height: size }} aria-label="Grand Vallum" title="Grand Vallum">
      <img src={laurels} alt="" className="absolute inset-0 h-full w-full object-contain" aria-hidden="true" />
      <ChiRhoMark size={Math.max(8, Math.round(size * 0.34))} className="relative z-10" />
    </span>
  );
}

export function VallumText({ text, size = 13 }: { text: string; size?: number }) {
  return <>{text.split(/(Grand Vallum|Vallum)/gi).map((part, index) => (
    /vallum/i.test(part) ? (
      <span key={`${part}-${index}`} className="inline-flex items-center gap-1 whitespace-nowrap">
        <ChiRhoMark size={size} className="text-current" />
        <span>{part}</span>
      </span>
    ) : part
  ))}</>;
}
