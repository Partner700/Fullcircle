import laurels from '../assets/brand-real/laureats.png';
import { publicAsset } from '../lib/publicAsset';

export function ChiRhoMark({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <span
      className={`inline-block shrink-0 bg-current ${className}`}
      style={{
        width: size,
        height: size,
        WebkitMask: `url(${publicAsset('labarum-mark.png')}) center / contain no-repeat`,
        mask: `url(${publicAsset('labarum-mark.png')}) center / contain no-repeat`,
      }}
      aria-label="Labarum"
      title="Labarum"
    />
  );
}

export function GrandVallumMark({ size = 24, className = '' }: { size?: number; className?: string }) {
  return (
    <span className={`relative inline-flex shrink-0 items-center justify-center ${className}`} style={{ width: size, height: size }} aria-label="Grand Vallum" title="Grand Vallum">
      <img src={laurels} alt="" className="absolute inset-0 h-full w-full object-contain" aria-hidden="true" />
      <ChiRhoMark size={Math.round(size * 0.48)} className="relative z-10" />
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
