import { useState } from 'react';

function storageKey(userId: string, method: string) {
  return `fullcircle:payment-number:${userId}:${method}`;
}

export function rememberMobileMoneyNumber(userId: string, method: string, phone: string) {
  if (method !== 'mtn_momo' && method !== 'orange_money') return;
  const match = phone.replace(/\D/g, '').match(/^(?:(?:00)?237)?0?(6\d{8})$/);
  if (!match) return;
  try {
    localStorage.setItem(storageKey(userId, method), match[1]);
  } catch {
    // Checkout still works when device storage is unavailable.
  }
}

export function SavedMobileMoneyNumber({ userId, method, onSelect }: {
  userId?: string;
  method: string;
  onSelect: (phone: string) => void;
}) {
  const [, refresh] = useState(0);
  if (!userId) return null;
  const key = storageKey(userId, method);
  let phone: string | null = null;
  try { phone = localStorage.getItem(key); } catch { return null; }
  if (!phone || !/^6\d{8}$/.test(phone)) return null;
  const savedPhone = phone;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
      <button type="button" className="btn-secondary" onClick={() => onSelect(savedPhone)}>
        Use saved number {savedPhone}
      </button>
      <button type="button" className="text-stone underline" onClick={() => {
        try { localStorage.removeItem(key); } catch { return; }
        refresh(value => value + 1);
      }}>Forget number</button>
    </div>
  );
}
