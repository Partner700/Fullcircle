export function ChiRhoMark({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <span
      className={`inline-flex items-center justify-center font-serif font-black leading-none ${className}`}
      style={{ fontSize: size }}
      aria-label="Labarum"
      title="Labarum"
    >
      ☧
    </span>
  );
}

export function GrandVallumMark({ size = 24, className = '' }: { size?: number; className?: string }) {
  return <span className={`inline-flex items-center justify-center rounded-full border-2 border-current px-1 ${className}`} style={{ fontSize: size }} aria-label="Grand Vallum"><ChiRhoMark size={size - 2} /></span>;
}
