export const PROFILE_COUNTRIES = [
  { code: 'CM', name: 'Cameroon', timezone: 'Africa/Douala' },
  { code: 'NG', name: 'Nigeria', timezone: 'Africa/Lagos' },
  { code: 'GH', name: 'Ghana', timezone: 'Africa/Accra' },
  { code: 'KE', name: 'Kenya', timezone: 'Africa/Nairobi' },
  { code: 'ZA', name: 'South Africa', timezone: 'Africa/Johannesburg' },
  { code: 'GB', name: 'United Kingdom', timezone: 'Europe/London' },
  { code: 'US', name: 'United States', timezone: 'America/New_York' },
  { code: 'CA', name: 'Canada', timezone: 'America/Toronto' },
  { code: 'FR', name: 'France', timezone: 'Europe/Paris' },
  { code: 'DE', name: 'Germany', timezone: 'Europe/Berlin' },
] as const;

export const PROFILE_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'fr', name: 'Français' },
] as const;

export function timezoneForCountry(countryCode: string) {
  return PROFILE_COUNTRIES.find((country) => country.code === countryCode)?.timezone || 'Africa/Douala';
}
