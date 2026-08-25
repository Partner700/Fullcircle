import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Coins } from 'lucide-react';
import { DENARII_GAIN_EVENT } from '../lib/denariiAnimation';

type Burst = {
  id: number;
  amount: number;
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
};

const COIN_OFFSETS = [-34, -20, -7, 8, 22, 35];

export function DenariiGainAnimation() {
  const [bursts, setBursts] = useState<Burst[]>([]);
  const nextIdRef = useRef(1);
  const timersRef = useRef<number[]>([]);

  useEffect(() => {
    const handleGain = (event: Event) => {
      const amount = Number((event as CustomEvent<{ amount?: number }>).detail?.amount) || 0;
      if (amount <= 0) return;

      const target = document.querySelector<HTMLElement>('[data-denarii-target]');
      if (!target) return;
      const targetRect = target.getBoundingClientRect();
      const id = nextIdRef.current++;
      const burst: Burst = {
        id,
        amount,
        startX: window.innerWidth * 0.5,
        startY: Math.max(targetRect.bottom + 110, window.innerHeight * 0.72),
        targetX: targetRect.left + targetRect.width * 0.5,
        targetY: targetRect.top + targetRect.height * 0.5,
      };

      setBursts((current) => [...current.slice(-2), burst]);
      const timer = window.setTimeout(() => {
        setBursts((current) => current.filter((item) => item.id !== id));
      }, 1_650);
      timersRef.current.push(timer);
    };

    window.addEventListener(DENARII_GAIN_EVENT, handleGain);
    return () => {
      window.removeEventListener(DENARII_GAIN_EVENT, handleGain);
      timersRef.current.forEach((timer) => window.clearTimeout(timer));
      timersRef.current = [];
    };
  }, []);

  const latestAmount = bursts[bursts.length - 1]?.amount || 0;

  return (
    <>
      <span className="sr-only" aria-live="polite">
        {latestAmount > 0 ? `${latestAmount.toLocaleString()} Denarii added` : ''}
      </span>
      <div className="pointer-events-none fixed inset-0 z-[150] overflow-hidden" aria-hidden="true">
        {bursts.map((burst) => (
          <div key={burst.id}>
            {COIN_OFFSETS.map((offset, index) => {
              const startX = burst.startX + offset;
              const startY = burst.startY + Math.abs(offset) * 0.24;
              const style = {
                left: startX,
                top: startY,
                '--denarii-flight-x': `${burst.targetX - startX}px`,
                '--denarii-flight-y': `${burst.targetY - startY}px`,
                animationDelay: `${index * 45}ms`,
              } as CSSProperties;
              return (
                <span key={`${burst.id}-${offset}`} className="denarii-flight-coin" style={style}>
                  <Coins size={20} strokeWidth={2.4} />
                </span>
              );
            })}
            <span
              className="denarii-flight-amount"
              style={{ left: burst.startX, top: burst.startY } as CSSProperties}
            >
              +{burst.amount.toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
