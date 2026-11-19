import { CalendarClock, Eye, Play, Share2, Swords, Trophy } from 'lucide-react';
import type { ReactNode } from 'react';
import { PanelImageBackdrop } from './PanelImageBackdrop';
import { UserAvatar } from './UserAvatar';
import { TentHouseSymbol } from './TentHouseSymbol';
import type { PanelImageSetting } from '../lib/types';
import { interTentLegLabel, interTentMatchLabel, type InterTentFixture } from '../lib/interTentChampionship';
import { formatPlayerNumber } from '../lib/utils';

const dateLabel = (value: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Douala', weekday: 'long', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(value));

function houseId(name: string) {
  if (/laurel|laureat/i.test(name)) return 'laureats';
  if (/spade/i.test(name)) return 'spades';
  if (/square/i.test(name)) return 'squares';
  if (/daric/i.test(name)) return 'darics';
  if (/rh?ude/i.test(name)) return 'rudes';
  return null;
}

export function InterTentMatchCard({ fixture, arenaImage, avatars, participant, draft, onOpen, onShare, children }: {
  fixture: InterTentFixture;
  arenaImage?: PanelImageSetting | null;
  avatars: Record<string, string | null>;
  participant: boolean;
  draft: boolean;
  onOpen: () => void;
  onShare?: () => void;
  children?: ReactNode;
}) {
  const canOpen = Boolean(fixture.room_id && (fixture.room_status === 'waiting' || fixture.room_status === 'playing'));
  const status = fixture.result ? 'Completed' : draft ? 'Qualification pending' : fixture.room_status === 'playing' ? 'Live now' : fixture.room_status === 'waiting' ? 'Scheduled' : fixture.sides.length ? 'Awaiting scheduling' : 'Awaiting qualifiers';
  const placeholders = fixture.stage === 'semi' ? ['Laurel #1', 'Spades #1', 'Square #1'] : ['Semifinal #1', 'Semifinal #2'];
  const matchLabel = fixture.sides.length ? fixture.sides.map(side=>side.players.map(p=>formatPlayerNumber(p.player_number)).join(' & ')).join(' vs ') : interTentMatchLabel(fixture);
  return <article data-artwork-theme={arenaImage?.url ? 'night' : undefined} className="card relative min-w-0 overflow-hidden p-3 sm:p-4" aria-label={`Match ${fixture.sequence}: ${matchLabel}`}>
    <PanelImageBackdrop image={arenaImage} opacityFallback={22} veilClassName="arena-panel-veil" />
    <div className="relative z-10 space-y-3">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div><p className="eyebrow text-gold">Journey Trivia · David</p><h5 className="mt-1 font-display text-sm font-bold text-ink">Match {fixture.sequence} · {interTentLegLabel(fixture)}</h5></div>
        <span className={`badge text-[10px] ${fixture.room_status === 'playing' ? 'text-coral' : fixture.result ? 'text-sage' : 'text-stone'}`}>{status}</span>
      </header>
      <div className="flex flex-wrap items-center justify-center gap-1.5 text-center text-xs font-semibold text-ink"><CalendarClock size={15} className="text-gold" /><time dateTime={fixture.planned_at}>{dateLabel(fixture.planned_at)}</time><span className="text-[10px] text-stone">Cameroon time</span></div>
      <div className="flex min-w-0 items-stretch justify-center gap-1 sm:gap-3">
        {fixture.sides.length ? fixture.sides.map((side, index) => {
          const symbol = houseId(side.tent_name);
          const result = fixture.result?.find(row => row.tent_id === side.tent_id);
          return <div key={side.tent_id} className="contents">
            {index > 0 && <span className="flex shrink-0 items-center self-center text-gold" aria-label="versus"><Swords size={16} /></span>}
            <div className="flex min-w-0 flex-1 flex-col items-center gap-2 rounded-lg border border-border bg-surface/55 p-2 text-center">
              <div className="flex min-w-0 flex-wrap items-center justify-center gap-1.5">{symbol && <TentHouseSymbol houseId={symbol} size={23}/>}<span className="break-words text-[10px] font-bold text-stone">{side.tent_name}</span></div>
              <div className="flex flex-wrap justify-center gap-1.5">{side.players.map(player => <div key={player.id} className="flex min-w-0 flex-col items-center gap-1" title={player.name}><UserAvatar userId={player.id} name={player.name} avatarUrl={avatars[player.id]} className="h-10 w-10 shrink-0 border border-gold/35 sm:h-12 sm:w-12" /><span className="font-display text-sm font-bold tabular-nums text-ink">{formatPlayerNumber(player.player_number)}</span></div>)}</div>
              {result && <p className="font-display text-base font-bold text-gold tabular-nums">{result.points} pts</p>}
            </div>
          </div>;
        }) : placeholders.map((name, index) => <div className="contents" key={name}>{index > 0 && <Swords size={16} className="shrink-0 self-center text-gold" aria-label="versus" />}<div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border p-3 text-center"><Trophy size={22} className="text-gold"/><span className="break-words text-xs font-bold text-ink">{name}</span></div></div>)}
      </div>
      {(canOpen || children) && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
        {canOpen && onShare && <button type="button" className="btn-ghost h-9 w-9 shrink-0 p-0" title="Share Arena match" aria-label="Share Arena match" onClick={onShare}><Share2 size={15}/></button>}
        {canOpen && <button type="button" className={participant ? 'btn-primary text-xs' : 'btn-secondary text-xs'} onClick={onOpen}>{participant ? <Play size={14}/> : <Eye size={14}/>} {participant ? 'Enter Match' : 'Witness'}</button>}
        {children}
      </footer>}
    </div>
  </article>;
}
