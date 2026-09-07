export const PROFILE_COUNTRIES = [
  { code: 'CM', name: 'Cameroon', timezone: 'Africa/Douala', dialCode: '+237' },
  { code: 'NG', name: 'Nigeria', timezone: 'Africa/Lagos', dialCode: '+234' },
  { code: 'GH', name: 'Ghana', timezone: 'Africa/Accra', dialCode: '+233' },
  { code: 'KE', name: 'Kenya', timezone: 'Africa/Nairobi', dialCode: '+254' },
  { code: 'ZA', name: 'South Africa', timezone: 'Africa/Johannesburg', dialCode: '+27' },
  { code: 'GB', name: 'United Kingdom', timezone: 'Europe/London', dialCode: '+44' },
  { code: 'US', name: 'United States', timezone: 'America/New_York', dialCode: '+1' },
  { code: 'CA', name: 'Canada', timezone: 'America/Toronto', dialCode: '+1' },
  { code: 'FR', name: 'France', timezone: 'Europe/Paris', dialCode: '+33' },
  { code: 'DE', name: 'Germany', timezone: 'Europe/Berlin', dialCode: '+49' },
] as const;

export const PROFILE_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'fr', name: 'Français' },
] as const;

export function timezoneForCountry(countryCode: string) {
  return PROFILE_COUNTRIES.find((country) => country.code === countryCode)?.timezone || 'Africa/Douala';
}

export function dialCodeForCountry(countryCode?: string | null) {
  return PROFILE_COUNTRIES.find((country) => country.code === countryCode)?.dialCode || '+237';
}

export function localPhoneNumber(value: string, countryCode?: string | null) {
  let digits = value.replace(/\D/g, '');
  const selectedCode = dialCodeForCountry(countryCode).slice(1);
  const knownCodes = Array.from(new Set(PROFILE_COUNTRIES.map((country) => country.dialCode.slice(1))))
    .sort((a, b) => b.length - a.length);
  const matchingCode = digits.startsWith(selectedCode)
    ? selectedCode
    : knownCodes.find((code) => digits.startsWith(code));
  if (matchingCode) digits = digits.slice(matchingCode.length);
  return digits.replace(/^0+/, '');
}

export function phoneNumberForCountry(value: string, countryCode?: string | null) {
  const local = localPhoneNumber(value, countryCode);
  return local ? `${dialCodeForCountry(countryCode)}${local}` : '';
}
