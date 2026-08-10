import { useState } from 'react';
import { Globe2, Languages, Loader2, MessageCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { PROFILE_COUNTRIES, PROFILE_LANGUAGES, timezoneForCountry } from '../lib/profileOptions';

export function ProfileOnboarding() {
  const { profile, refreshProfile, signOut } = useAuth();
  const [country, setCountry] = useState(profile?.country_code || 'CM');
  const [whatsapp, setWhatsapp] = useState(profile?.whatsapp_number || '');
  const [language, setLanguage] = useState(profile?.language_code || 'en');
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
    setSaving(true);
    setError(null);
    const { error: updateError } = await supabase.from('profiles').update({
      country_code: country,
      whatsapp_number: phone,
      language_code: language,
      timezone: timezoneForCountry(country),
      onboarding_completed: true,
    }).eq('id', profile.id);
    if (updateError) {
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
        {error && <div className="rounded-lg bg-coral-soft p-3 text-sm text-coral">{error}</div>}
        <button type="submit" disabled={saving} className="btn-primary w-full">{saving && <Loader2 size={17} className="animate-spin" />} Continue</button>
        <button type="button" onClick={() => void signOut()} className="btn-ghost w-full text-xs">Use another account</button>
      </form>
    </main>
  );
}
