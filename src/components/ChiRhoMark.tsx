import laurels from '../assets/brand-real/laureats.png';

export function ChiRhoMark({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <span
      className={`fc-chi-rho-inline relative inline-flex shrink-0 items-center justify-center ${className}`}
      style={{ width: size, height: size }}
      aria-label="Labarum"
      title="Labarum"
    >
      <svg
        className="fc-chi-rho-glyph block h-full w-full overflow-visible"
        viewBox="0 0 100 100"
        fill="currentColor"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path d="M45 4h10v92H45z" />
        <path d="M50 4h11c11 0 18 7 18 18s-7 18-18 18H50v-9h11c6 0 9-3 9-9s-3-9-9-9H50z" />
        <path d="M15 34l7-9 63 48-7 9zM78 25l7 9-63 48-7-9z" />
      </svg>
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
