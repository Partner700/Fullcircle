import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  HelpCircle,
  Coins,
  Gift,
  Loader2,
  LockKeyhole,
  Plus,
  Send,
  Square,
  Trash2,
  Upload,
  Users,
  Volume2,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  closeDoveQuestion,
  fetchInstructorDoveQuestionParticipants,
  fetchInstructorDoveQuestions,
  publishDoveQuestion,
} from '../lib/doveQuestions';
import { supabase } from '../lib/supabase';
import { VallumAvatarBadge } from './VallumAvatarBadge';
import type {
  DoveQuestion,
  DoveQuestionDeliveryMode,
  DoveQuestionParticipant,
  DoveQuestionType,
} from '../lib/types';
import { cn } from '../lib/utils';
import { AppSelect } from './AppSelect';
import { Dove } from './Dove';

const QUESTION_TYPES = [
  { value: 'multiple_choice', label: 'Multiple choice' },
  { value: 'true_false', label: 'True or false' },
  { value: 'fill_blank', label: 'Fill in the blank' },
  { value: 'standard_text', label: 'Written answer' },
];

const EXPIRY_OPTIONS = [
  { value: '1', label: '1 hour' },
  { value: '6', label: '6 hours' },
  { value: '24', label: '24 hours' },
  { value: '168', label: '7 days' },
  { value: 'none', label: 'No expiry' },
];

type ParticipantWithQuestion = DoveQuestionParticipant & { question_id: string };

function ParticipantStack({ participants }: { participants: DoveQuestionParticipant[] }) {
  const shown = participants.slice(0, 12);
  return (
    <div className="flex min-h-6 items-center" aria-label={`${participants.length} people answered`}>
      {shown.map((participant, index) => (
        <span
          key={participant.user_id}
          title={participant.display_name}
          className="relative flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-peri"
          style={{ marginLeft: index === 0 ? 0 : -6, zIndex: shown.length - index }}
        >
          <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full border border-peri/45 bg-surface-2 shadow-sm">
            {participant.avatar_url ? (
              <img src={participant.avatar_url} alt={participant.display_name} className="h-full w-full object-cover" />
            ) : participant.display_name.trim().charAt(0).toUpperCase()}
          </span>
          <VallumAvatarBadge userId={participant.user_id} size="xs" />
        </span>
      ))}
      {participants.length > shown.length && (
        <span className="ml-1 text-[10px] font-bold text-stone">+{participants.length - shown.length}</span>
      )}
    </div>
  );
}

function parseAmount(value: string, label: string) {
  const amount = Number(value);
  if (!Number.isInteger(amount) || amount < 0 || amount > 100_000_000) {
    throw new Error(`${label} must be a whole number between 0 and 100,000,000.`);
  }
  return amount;
}

function expiresAtFromHours(value: string) {
  if (value === 'none') return null;
  return new Date(Date.now() + Number(value) * 60 * 60 * 1000).toISOString();
}

export function DoveQuestionManager() {
  const { profile } = useAuth();
  const [questionText, setQuestionText] = useState('');
  const [questionType, setQuestionType] = useState<DoveQuestionType>('multiple_choice');
  const [options, setOptions] = useState(['', '', '', '']);
  const [correctAnswer, setCorrectAnswer] = useState('');
  const [acceptedAnswers, setAcceptedAnswers] = useState('');
  const [explanation, setExplanation] = useState('');
  const [entryCost, setEntryCost] = useState('0');
  const [reward, setReward] = useState('100');
  const [deliveryMode, setDeliveryMode] = useState<DoveQuestionDeliveryMode>('optional');
  const [expiryHours, setExpiryHours] = useState('24');
  const [soundUrl, setSoundUrl] = useState<string | null>(null);
  const [soundName, setSoundName] = useState<string | null>(null);
  const [uploadingSound, setUploadingSound] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<DoveQuestion[]>([]);
  const [participantsByQuestion, setParticipantsByQuestion] = useState<Record<string, DoveQuestionParticipant[]>>({});
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const items = await fetchInstructorDoveQuestions();
      setQuestions(items);
      const participants = await fetchInstructorDoveQuestionParticipants(items.map((item) => item.id));
      const grouped: Record<string, DoveQuestionParticipant[]> = {};
      participants.forEach((participant: ParticipantWithQuestion) => {
        (grouped[participant.question_id] ||= []).push(participant);
      });
      setParticipantsByQuestion(grouped);
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Dove Questions could not be loaded.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!profile) return;
    const channel = supabase
      .channel(`dove_question_manager_${profile.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dove_questions' }, () => { void load(); })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dove_question_participants' }, () => { void load(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [load, profile]);

  const cleanedOptions = useMemo(() => options.map((option) => option.trim()).filter(Boolean), [options]);

  const changeQuestionType = (next: string) => {
    const type = next as DoveQuestionType;
    setQuestionType(type);
    setCorrectAnswer('');
    setAcceptedAnswers('');
    if (type === 'multiple_choice') setOptions(['', '', '', '']);
    if (type === 'true_false') setOptions(['True', 'False']);
  };

  const updateOption = (index: number, value: string) => {
    setOptions((current) => current.map((option, optionIndex) => optionIndex === index ? value : option));
    if (correctAnswer === options[index]) setCorrectAnswer(value);
  };

  const removeOption = (index: number) => {
    const removed = options[index];
    setOptions((current) => current.filter((_, optionIndex) => optionIndex !== index));
    if (correctAnswer === removed) setCorrectAnswer('');
  };

  const uploadSound = async (file: File) => {
    setNotice(null);
    setUploadingSound(true);
    try {
      if (!profile) throw new Error('Please sign in again before uploading a sound.');
      if (!file.type.startsWith('audio/')) throw new Error('Choose an audio file.');
      if (file.size > 15 * 1024 * 1024) throw new Error('Sound files must be 15 MB or smaller.');
      const safeName = file.name.replace(/[^a-z0-9._-]/gi, '-').toLowerCase();
      const path = `sound-assets/dove-questions/${profile.id}/${Date.now()}-${safeName}`;
      const { error } = await supabase.storage.from('avatars').upload(path, file, {
        upsert: false,
        contentType: file.type,
      });
      if (error) throw error;
      const { data } = supabase.storage.from('avatars').getPublicUrl(path);
      setSoundUrl(`${data.publicUrl}?v=${Date.now()}`);
      setSoundName(file.name);
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'The sound could not be uploaded.' });
    } finally {
      setUploadingSound(false);
    }
  };

  const resetComposer = () => {
    setQuestionText('');
    setQuestionType('multiple_choice');
    setOptions(['', '', '', '']);
    setCorrectAnswer('');
    setAcceptedAnswers('');
    setExplanation('');
    setEntryCost('0');
    setReward('100');
    setDeliveryMode('optional');
    setExpiryHours('24');
    setSoundUrl(null);
    setSoundName(null);
  };

  const publish = async () => {
    if (publishing) return;
    setNotice(null);
    setPublishing(true);
    try {
      if (!questionText.trim()) throw new Error('Enter the question first.');
      if (!correctAnswer.trim()) throw new Error('Choose or enter the correct answer.');
      if (questionType === 'multiple_choice' && cleanedOptions.length < 2) {
        throw new Error('Add at least two answer choices.');
      }
      if (questionType === 'multiple_choice' && !cleanedOptions.some((option) => option === correctAnswer.trim())) {
        throw new Error('Mark one of the choices as the correct answer.');
      }
      await publishDoveQuestion({
        questionText: questionText.trim(),
        questionType,
        options: questionType === 'true_false' ? ['True', 'False'] : questionType === 'multiple_choice' ? cleanedOptions : [],
        correctAnswer: correctAnswer.trim(),
        acceptedAnswers: acceptedAnswers.split(/[\n,]/).map((answer) => answer.trim()).filter(Boolean),
        explanation: explanation.trim() || null,
        entryCostDenarii: parseAmount(entryCost, 'Entry cost'),
        rewardDenarii: parseAmount(reward, 'Reward'),
        deliveryMode,
        soundUrl,
        expiresAt: expiresAtFromHours(expiryHours),
      });
      resetComposer();
      setNotice({ tone: 'success', text: 'The Dove Question has been sent to every active user.' });
      await load();
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'The Dove Question could not be sent.' });
    } finally {
      setPublishing(false);
    }
  };

  const closeQuestion = async (question: DoveQuestion) => {
    if (closingId || !window.confirm('Close this question for everyone who has not answered it?')) return;
    setClosingId(question.id);
    setNotice(null);
    try {
      await closeDoveQuestion(question.id);
      setNotice({ tone: 'success', text: 'The question is now closed.' });
      await load();
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'The question could not be closed.' });
    } finally {
      setClosingId(null);
    }
  };

  return (
    <div className="space-y-5">
      <section className="card overflow-hidden">
        <div className="border-b border-border bg-surface-2 px-5 py-4">
          <div className="flex items-center gap-3">
            <Dove size={54} className="animate-float" />
            <div>
              <h2 className="font-display text-lg font-bold text-ink">Send a Dove Question</h2>
              <p className="text-xs text-stone">It appears immediately for every active user.</p>
            </div>
          </div>
        </div>

        <div className="space-y-5 p-5">
          {notice && (
            <div role="status" className={cn('rounded-md border px-3 py-2 text-sm', notice.tone === 'success' ? 'border-sage/35 bg-sage/10 text-sage' : 'border-coral/35 bg-coral/10 text-coral')}>
              {notice.text}
            </div>
          )}

          <div>
            <label htmlFor="dove-question-text" className="mb-1 block text-xs font-semibold text-ink">Question</label>
            <textarea
              id="dove-question-text"
              value={questionText}
              onChange={(event) => setQuestionText(event.target.value)}
              rows={4}
              maxLength={2000}
              className="input-field w-full resize-y whitespace-pre-wrap text-sm"
              placeholder="Write the question exactly as users should see it"
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink">Answer format</label>
              <AppSelect value={questionType} onChange={changeQuestionType} options={QUESTION_TYPES} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink">Availability</label>
              <AppSelect value={expiryHours} onChange={setExpiryHours} options={EXPIRY_OPTIONS} />
            </div>
          </div>

          <div>
            <label className="mb-2 block text-xs font-semibold text-ink">Delivery</label>
            <div className="grid grid-cols-2 overflow-hidden rounded-md border border-border-bright bg-surface-2 p-1">
              <button type="button" onClick={() => setDeliveryMode('optional')} className={cn('flex min-h-11 items-center justify-center gap-2 rounded px-3 text-xs font-bold transition-colors', deliveryMode === 'optional' ? 'bg-surface text-peri shadow-sm' : 'text-stone')}>
                <HelpCircle size={16} /> Optional
              </button>
              <button type="button" onClick={() => setDeliveryMode('required')} className={cn('flex min-h-11 items-center justify-center gap-2 rounded px-3 text-xs font-bold transition-colors', deliveryMode === 'required' ? 'bg-coral/12 text-coral shadow-sm' : 'text-stone')}>
                <LockKeyhole size={16} /> Obligatory
              </button>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-stone">
              Obligatory questions cover the app until the user submits either a right or wrong answer.
            </p>
          </div>

          {(questionType === 'multiple_choice' || questionType === 'true_false') && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <label className="text-xs font-semibold text-ink">Choices and correct answer</label>
                {questionType === 'multiple_choice' && (
                  <button type="button" onClick={() => setOptions((current) => [...current, ''])} className="icon-btn" title="Add answer choice" aria-label="Add answer choice">
                    <Plus size={16} />
                  </button>
                )}
              </div>
              {(questionType === 'true_false' ? ['True', 'False'] : options).map((option, index) => (
                <div key={`${questionType}-${index}`} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setCorrectAnswer(option)}
                    disabled={!option.trim()}
                    aria-label={`Mark choice ${index + 1} correct`}
                    className={cn('flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border transition-colors', correctAnswer === option && option.trim() ? 'border-sage bg-sage text-white' : 'border-border-bright bg-surface-2 text-stone')}
                  >
                    {correctAnswer === option && option.trim() ? <CheckCircle2 size={17} /> : <span className="h-2.5 w-2.5 rounded-full border border-current" />}
                  </button>
                  <input
                    value={option}
                    onChange={(event) => updateOption(index, event.target.value)}
                    readOnly={questionType === 'true_false'}
                    className="input-field min-w-0 flex-1 text-sm"
                    placeholder={`Choice ${index + 1}`}
                  />
                  {questionType === 'multiple_choice' && options.length > 2 && (
                    <button type="button" onClick={() => removeOption(index)} className="icon-btn text-coral" title="Remove choice" aria-label={`Remove choice ${index + 1}`}>
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {(questionType === 'fill_blank' || questionType === 'standard_text') && (
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label htmlFor="dove-correct-answer" className="mb-1 block text-xs font-semibold text-ink">Correct answer</label>
                <input id="dove-correct-answer" value={correctAnswer} onChange={(event) => setCorrectAnswer(event.target.value)} className="input-field w-full text-sm" />
              </div>
              <div>
                <label htmlFor="dove-accepted-answers" className="mb-1 block text-xs font-semibold text-ink">Other accepted answers</label>
                <input id="dove-accepted-answers" value={acceptedAnswers} onChange={(event) => setAcceptedAnswers(event.target.value)} className="input-field w-full text-sm" placeholder="Separate with commas" />
              </div>
            </div>
          )}

          <div>
            <label htmlFor="dove-explanation" className="mb-1 block text-xs font-semibold text-ink">Explanation after answering</label>
            <textarea id="dove-explanation" value={explanation} onChange={(event) => setExplanation(event.target.value)} rows={2} className="input-field w-full resize-y text-sm" placeholder="Optional" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="rounded-md border border-border bg-surface-2 p-3">
              <span className="mb-2 flex items-center gap-2 text-xs font-semibold text-ink"><Coins size={15} className="text-brass" /> Cost to answer</span>
              <input type="number" min="0" step="1" value={entryCost} onChange={(event) => setEntryCost(event.target.value)} className="input-field w-full text-sm" inputMode="numeric" />
              <span className="mt-1 block text-[10px] text-stone">Denarii</span>
            </label>
            <label className="rounded-md border border-border bg-surface-2 p-3">
              <span className="mb-2 flex items-center gap-2 text-xs font-semibold text-ink"><Gift size={15} className="text-sage" /> Reward for a correct answer</span>
              <input type="number" min="0" step="1" value={reward} onChange={(event) => setReward(event.target.value)} className="input-field w-full text-sm" inputMode="numeric" />
              <span className="mt-1 block text-[10px] text-stone">Denarii</span>
            </label>
          </div>

          <div className="rounded-md border border-border bg-surface-2 p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <Volume2 size={17} className="flex-shrink-0 text-peri" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-ink">Question sound</p>
                  <p className="truncate text-[10px] text-stone">{soundName || 'No sound attached'}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <label className={cn('btn-secondary cursor-pointer px-2.5 py-1.5 text-xs', uploadingSound && 'pointer-events-none opacity-60')}>
                  {uploadingSound ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                  {soundUrl ? 'Replace' : 'Upload'}
                  <input type="file" accept="audio/mpeg,audio/mp4,audio/wav,audio/ogg,audio/*" className="hidden" onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file) void uploadSound(file);
                  }} />
                </label>
                {soundUrl && <button type="button" onClick={() => { setSoundUrl(null); setSoundName(null); }} className="icon-btn text-coral" title="Remove sound" aria-label="Remove question sound"><X size={15} /></button>}
              </div>
            </div>
            {soundUrl && <audio src={soundUrl} controls className="mt-3 h-9 w-full" />}
          </div>

          <button type="button" onClick={() => void publish()} disabled={publishing} className="btn-primary w-full justify-center py-3">
            {publishing ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />}
            {publishing ? 'Sending...' : 'Send with the Dove'}
          </button>
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-base font-bold text-ink">Sent Questions</h3>
            <p className="text-xs text-stone">Respondents appear here as they answer.</p>
          </div>
          <Users size={18} className="text-peri" />
        </div>

        {loading ? (
          <div className="flex justify-center py-10"><Loader2 size={22} className="animate-spin text-peri" /></div>
        ) : questions.length === 0 ? (
          <div className="rounded-md border border-dashed border-border-bright px-5 py-10 text-center text-sm text-stone">No Dove Questions have been sent yet.</div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {questions.map((question) => {
              const participants = participantsByQuestion[question.id] || [];
              return (
                <article key={question.id} className="card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="mb-2 flex flex-wrap items-center gap-1.5">
                        <span className={cn('rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase', question.delivery_mode === 'required' ? 'border-coral/35 bg-coral/10 text-coral' : 'border-peri/30 bg-peri/10 text-peri')}>
                          {question.delivery_mode === 'required' ? 'Obligatory' : 'Optional'}
                        </span>
                        <span className={cn('rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase', question.status === 'active' ? 'border-sage/35 bg-sage/10 text-sage' : 'border-border bg-surface-2 text-stone')}>
                          {question.status}
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap text-sm font-semibold leading-relaxed text-ink">{question.question_text}</p>
                      <p className="mt-2 text-[11px] text-stone">Answer: <strong className="text-ink">{question.correct_answer}</strong></p>
                    </div>
                    {question.status === 'active' && (
                      <button type="button" onClick={() => void closeQuestion(question)} disabled={closingId === question.id} className="icon-btn flex-shrink-0 text-coral" title="Close question" aria-label="Close question">
                        {closingId === question.id ? <Loader2 size={15} className="animate-spin" /> : <Square size={14} />}
                      </button>
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
                    <div className="flex flex-wrap items-center gap-3 text-[10px] font-semibold text-stone">
                      <span className="inline-flex items-center gap-1"><Coins size={12} className="text-brass" /> {question.entry_cost_denarii} cost</span>
                      <span className="inline-flex items-center gap-1"><Gift size={12} className="text-sage" /> {question.reward_denarii} reward</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <ParticipantStack participants={participants} />
                      <span className="text-[10px] font-bold text-stone">{participants.length}</span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
