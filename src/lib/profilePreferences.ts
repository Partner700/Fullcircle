import { supabase } from './supabase';
import { timezoneForCountry } from './profileOptions';

export function formatBirthdayInput(month?: number | null, day?: number | null) {
  if (!month || !day) return '';
  return `${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`;
}

export function parseBirthdayInput(value: string, required = false) {
  const trimmed = value.trim().replace(/\s+/g, '');
  if (!trimmed) {
    if (required) throw new Error('Enter your birthday as MM/DD.');
    return { month: null as number | null, day: null as number | null };
  }
  const match = trimmed.match(/^(\d{1,2})[\/.\-](\d{1,2})$/);
  if (!match) throw new Error('Enter your birthday as MM/DD, for example 08/12.');
  const month = Number(match[1]);
  const day = Number(match[2]);
  const maxDay = new Date(2026, month, 0).getDate();
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(day) || day < 1 || day > maxDay) {
    throw new Error('Enter a real birthday date as MM/DD.');
  }
  return { month, day };
}

export async function saveOwnProfilePreferences(input: {
  displayName?: string | null;
  whatsappNumber?: string | null;
  countryCode: string;
  languageCode: string;
  birthMonth: number | null;
  birthDay: number | null;
  onboardingCompleted?: boolean | null;
}) {
  const { error } = await supabase.rpc('save_own_profile_preferences', {
    p_display_name: input.displayName ?? null,
    p_whatsapp_number: input.whatsappNumber ?? null,
    p_country_code: input.countryCode,
    p_language_code: input.languageCode,
    p_timezone: timezoneForCountry(input.countryCode),
    p_birth_month: input.birthMonth,
    p_birth_day: input.birthDay,
    p_onboarding_completed: input.onboardingCompleted ?? null,
  });
  if (error) throw error;
}
