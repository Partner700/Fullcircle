import { useState } from 'react';
import { Cake, Globe2, Languages, Loader2, MessageCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { PROFILE_COUNTRIES, PROFILE_LANGUAGES } from '../lib/profileOptions';
import { formatBirthdayInput, parseBirthdayInput, saveOwnProfilePreferences } from '../lib/profilePreferences';

export function ProfileOnboarding() {
  const { profile, refreshProfile, signOut } = useAuth();
  const [country, setCountry] = useState(profile?.country_code || 'CM');
  const [whatsapp, setWhatsapp] = useState(profile?.whatsapp_number || '');
  const [language, setLanguage] = useState(profile?.language_code || 'en');
  const [birthday, setBirthday] = useState(formatBirthdayInput(profile?.birth_month, profile?.birth_day));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!profile || saving) return;
    const phone = whatsapp.replace(/[^+\d]/g, '');
    if (phone.length < 8) {
      setError('Enter a complete WhatsApp number, including the country code.');
      return;
    }
    let parsedBirthday;
    try {
      parsedBirthday = parseBirthdayInput(birthday, true);
    } catch (birthdayError: any) {
      setError(birthdayError.message || 'Enter your birthday as MM/DD.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveOwnProfilePreferences({
        whatsappNumber: phone,
        countryCode: country,
        languageCode: language,
        birthMonth: parsedBirthday.month,
        birthDay: parsedBirthday.day,
        onboardingCompleted: true,
      });
    } catch (updateError: any) {
      setError(updateError.message);
      setSaving(false);
      return;
    }
    document.documentElement.lang = language;
    await refreshProfile();
    setSaving(false);
  };

  return (
    <main className="min-h-screen bg-navy px-4 py-10 flex items-center justify-center">
      <form onSubmit={save} className="card w-full max-w-lg space-y-5 p-6 animate-slide-up">
        <div>
          <p className="eyebrow">One last step</p>
          <h1 className="mt-1 text-2xl font-bold text-ink">Complete your Full Circle profile</h1>
          <p className="mt-2 text-sm text-stone">These details set your local time, communication number, and preferred language.</p>
        </div>
        <label className="block">
          <span className="mb-1.5 flex items-center gap-2 text-sm font-bold text-ink"><Globe2 size={16} /> Country</span>
          <select className="input-field" value={country} onChange={(event) => setCountry(event.target.value)}>
            {PROFILE_COUNTRIES.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 flex items-center gap-2 text-sm font-bold text-ink"><MessageCircle size={16} /> WhatsApp number</span>
          <input className="input-field" type="tel" value={whatsapp} onChange={(event) => setWhatsapp(event.target.value)} placeholder="+237 6xx xxx xxx" required />
          <span className="mt-1 block text-xs text-stone">Include your international country code.</span>
        </label>
        <label className="block">
          <span className="mb-1.5 flex items-center gap-2 text-sm font-bold text-ink"><Languages size={16} /> Language</span>
          <select className="input-field" value={language} onChange={(event) => setLanguage(event.target.value)}>
            {PROFILE_LANGUAGES.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
          </select>
        </label>
        <div>
          <span className="mb-1.5 flex items-center gap-2 text-sm font-bold text-ink"><Cake size={16} /> Birthday</span>
          <input className="input-field" value={birthday} onChange={(event) => setBirthday(event.target.value)} placeholder="MM/DD" inputMode="numeric" required />
          <span className="mt-1 block text-xs text-stone">We only store the month and day, so the app can celebrate you.</span>
        </div>
        {error && <div className="rounded-lg bg-coral-soft p-3 text-sm text-coral">{error}</div>}
        <button type="submit" disabled={saving} className="btn-primary w-full">{saving && <Loader2 size={17} className="animate-spin" />} Continue</button>
        <button type="button" onClick={() => void signOut()} className="btn-ghost w-full text-xs">Use another account</button>
      </form>
    </main>
  );
}
