import { useEffect, useMemo, useState } from 'react';
import { BookOpen, CheckCircle2, Loader2, Lock, Send, UserPlus } from 'lucide-react';
import { Dove } from '../components/Dove';
import { completeSharedQuiz, fetchSharedQuiz, fetchSharedReading, saveSharedQuizAnswer } from '../lib/queries';
import { cn } from '../lib/utils';

type ShareKind = 'reading' | 'quiz';

function guestKey(sessionId: string) {
  const key = `full-circle-public-quiz:${sessionId}`;
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const value = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  window.localStorage.setItem(key, value);
  return value;
}

export function PublicShareScreen({ kind, value }: { kind: ShareKind; value: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState<any>(null);
  const [quiz, setQuiz] = useState<any>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [savingQuestion, setSavingQuestion] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const signupHref = useMemo(() => `${window.location.pathname}?signup=1`, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const load = kind === 'reading' ? fetchSharedReading(value) : fetchSharedQuiz(value);
    void load
      .then((data) => {
        if (cancelled) return;
        if (!data) throw new Error('This shared item is no longer available.');
        if (kind === 'reading') setReading(data);
        else setQuiz(data);
      })
      .catch((loadError: any) => { if (!cancelled) setError(loadError?.message || 'This shared item could not load.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [kind, value]);

  const saveAnswer = async (questionId: string, answer: string) => {
    if (!quiz?.session?.id) return;
    setAnswers((current) => ({ ...current, [questionId]: answer }));
    setSavingQuestion(questionId);
    try {
      await saveSharedQuizAnswer(quiz.session.id, guestKey(quiz.session.id), questionId, answer);
    } catch (saveError: any) {
      setError(saveError?.message || 'Your answer could not be saved.');
    } finally {
      setSavingQuestion(null);
    }
  };

  const submitQuiz = async () => {
    if (!quiz?.session?.id) return;
    try {
      await completeSharedQuiz(quiz.session.id, guestKey(quiz.session.id));
      setSubmitted(true);
    } catch (submitError: any) {
      setError(submitError?.message || 'Your quiz could not be submitted.');
    }
  };

  return (
    <main className="min-h-screen bg-navy px-4 py-8 text-ink">
      <div className="mx-auto max-w-2xl space-y-5">
        <header className="flex items-center justify-between gap-3">
          <a href={window.location.pathname} className="flex items-center gap-2 text-peri">
            <Dove size={36} />
            <span className="font-display text-lg font-black">Full Circle</span>
          </a>
          <a href={signupHref} className="btn-secondary text-xs"><UserPlus size={14} /> Join</a>
        </header>

        {loading && <section className="card flex min-h-64 items-center justify-center gap-2 text-stone"><Loader2 size={18} className="animate-spin" /> Opening shared content...</section>}
        {!loading && error && <section className="card p-6 text-center"><Dove size={32} className="mx-auto text-brass" /><h1 className="mt-3 font-display text-xl font-bold text-ink">This link is unavailable</h1><p className="mt-2 text-sm text-stone">{error}</p><a href={signupHref} className="btn-primary mt-4">Join Full Circle</a></section>}

        {!loading && !error && kind === 'reading' && reading && (
          <article className="card relative overflow-hidden p-5 sm:p-7">
            <div className="mb-4 flex items-center gap-2 text-brass"><BookOpen size={18} /><span className="eyebrow">Shared daily reading</span></div>
            <p className="text-sm font-semibold text-brass">{reading.scripture_reference} · {reading.translation}</p>
            <h1 className="mt-2 font-display text-3xl font-black text-ink">{reading.title}</h1>
            <p className="mt-1 text-sm text-stone">{reading.theme}</p>
            {reading.verse_of_day && <blockquote className="mt-5 border-l-2 border-brass/60 pl-4 font-display text-xl italic leading-relaxed text-ink">"{reading.verse_of_day}"</blockquote>}
            <div className="mt-6 space-y-6">
              {(reading.scripture_passages?.length ? reading.scripture_passages : [reading]).map((passage: any, passageIndex: number) => (
                <section key={`${passage.reference}-${passageIndex}`}>
                  <h2 className="text-sm font-black text-brass">{passage.reference}</h2>
                  <div className="mt-3 space-y-3">
                    {(passage.highlighted_verses?.length ? passage.highlighted_verses : [{ text: passage.main_text, reference: passage.reference }]).map((verse: any, verseIndex: number) => (
                      <p key={`${verse.reference}-${verseIndex}`} className="whitespace-pre-wrap text-[15px] leading-8 text-ink"><span className="mr-1.5 font-bold text-brass">{verse.reference || passage.reference}</span>{verse.text}</p>
                    ))}
                  </div>
                </section>
              ))}
            </div>
            <div className="mt-7 rounded-xl border border-brass/25 bg-brass-soft p-4">
              <p className="font-display text-lg font-bold text-ink">Take this reading with you.</p>
              <p className="mt-1 text-sm text-stone">Join Full Circle to respond, share this reading, and take part in the conversation.</p>
              <a href={signupHref} className="btn-primary mt-3"><UserPlus size={16} /> Join to share</a>
            </div>
          </article>
        )}

        {!loading && !error && kind === 'quiz' && quiz && (
          <article className="space-y-4">
            <section className="card p-5 sm:p-7">
              <p className="eyebrow text-brass">Shared weekly quiz</p>
              <h1 className="mt-2 font-display text-3xl font-black text-ink">{quiz.session.title}</h1>
              <p className="mt-2 text-sm text-stone">Answer as a guest, then join Full Circle to see your result.</p>
            </section>
            {quiz.session.status !== 'live' ? (
              <section className="card p-6 text-center"><Lock size={28} className="mx-auto text-brass" /><h2 className="mt-3 font-display text-xl font-bold text-ink">Quiz window closed</h2><p className="mt-2 text-sm text-stone">Join Full Circle to take future quizzes and receive results.</p><a href={signupHref} className="btn-primary mt-4">Join Full Circle</a></section>
            ) : submitted ? (
              <section className="card p-6 text-center"><CheckCircle2 size={32} className="mx-auto text-moss" /><h2 className="mt-3 font-display text-xl font-bold text-ink">Your answers are in.</h2><p className="mt-2 text-sm text-stone">Create your Full Circle account to see your result when it is released.</p><a href={signupHref} className="btn-primary mt-4">Join to see results</a></section>
            ) : (
              <>
                {quiz.questions.map((question: any, index: number) => {
                  const payload = question.question_payload || {};
                  const options = Array.isArray(payload.options) ? payload.options : [];
                  const currentAnswer = answers[question.id] || '';
                  return <section key={question.id} className="card p-5"><p className="text-xs font-bold text-brass">Question {index + 1}</p><p className="mt-2 text-base font-semibold leading-relaxed text-ink">{payload.question}</p>{options.length ? <div className="mt-4 space-y-2">{options.map((option: string, optionIndex: number) => <label key={`${option}-${optionIndex}`} className={cn('flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm', currentAnswer === option ? 'border-brass bg-brass-soft text-ink' : 'border-border bg-surface-2 text-stone')}><input type="radio" name={question.id} value={option} checked={currentAnswer === option} onChange={() => void saveAnswer(question.id, option)} /><span>{option}</span></label>)}</div> : <input className="input-field mt-4" value={currentAnswer} onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))} onBlur={(event) => { if (event.target.value.trim()) void saveAnswer(question.id, event.target.value.trim()); }} placeholder="Your answer" />}{savingQuestion === question.id && <p className="mt-2 text-[10px] text-stone">Saving...</p>}</section>;
                })}
                <button type="button" className="btn-primary w-full justify-center" disabled={Object.keys(answers).length < quiz.questions.length} onClick={() => void submitQuiz()}><Send size={16} /> Submit and join to see results</button>
              </>
            )}
          </article>
        )}
      </div>
    </main>
  );
}
