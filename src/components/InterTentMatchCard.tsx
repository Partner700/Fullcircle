import { CalendarClock, Eye, Play, Share2, Swords, Trophy, Radio } from 'lucide-react';
import { useState, useEffect, type ReactNode } from 'react';
import { PanelImageBackdrop } from './PanelImageBackdrop';
import { UserAvatar } from './UserAvatar';
import { TentHouseSymbol } from './TentHouseSymbol';
import { ArenaFinalScorecard } from './ArenaFinalScorecard';
import type { PanelImageSetting } from '../lib/types';
import { interTentCountdown, interTentLegLabel, interTentMatchLabel, type InterTentFixture } from '../lib/interTentChampionship';
import { formatPlayerNumber } from '../lib/utils';
import { arenaPlayerScore } from '../lib/arenaScorecard';
import type { ArenaMatchupPlayer } from '../lib/arenaMatchup';

const dateLabel = (value: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Douala', weekday: 'long', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(value));

function houseId(name: string) {
  if (/laurel|laureat/i.test(name)) return 'laureats';
  if (/spade/i.test(name)) return 'spades';
  if (/square/i.test(name)) return 'squares';
  if (/daric/i.test(name)) return 'darics';
  if (/rh?ude/i.test(name)) return 'rudes';
  return null;
}

function FixtureCountdown({ plannedAt, draft, live, completed, compact=false }: {plannedAt:string;draft:boolean;live:boolean;completed:boolean;compact?:boolean}) {
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{if(live||completed)return;const tick=()=>setNow(Date.now());tick();const timer=window.setInterval(tick,1000);return()=>window.clearInterval(timer);},[live,completed,plannedAt]);
  if(completed)return null;
  if(live)return <div className="flex items-center justify-center gap-1 text-xs font-bold text-coral"><Radio size={14} className="animate-pulse"/> LIVE · Scores updating</div>;
  const countdown=interTentCountdown(plannedAt,now);
  return <div className={`flex flex-wrap items-center justify-center gap-2 font-bold text-stone ${compact?'text-[10px]':'text-xs'}`}><span>{countdown.remaining?'Starts in':draft&&!compact?'Awaiting qualification':'Match time'}</span>{countdown.remaining>0&&<span className={`font-display font-black tabular-nums text-gold ${compact?'text-sm':'text-lg'}`}>{countdown.text}</span>}</div>;
}

export function InterTentMatchCard({ fixture, arenaImage, avatars, participant, draft, livePlayers, compact, onOpen, onShare, children }: {
  fixture: InterTentFixture;
  arenaImage?: PanelImageSetting | null;
  avatars: Record<string, string | null>;
  participant: boolean;
  draft: boolean;
  livePlayers?: ArenaMatchupPlayer[];
  compact?: boolean;
  onOpen: () => void;
  onShare?: () => void;
  children?: ReactNode;
}) {
  const canOpen = Boolean(fixture.room_id && (fixture.room_status === 'waiting' || fixture.room_status === 'playing'));
  const status = fixture.result ? 'Completed' : draft ? 'Qualification pending' : fixture.room_status === 'playing' ? 'Live now' : fixture.room_status === 'waiting' ? 'Scheduled' : fixture.sides.length ? 'Scheduled' : 'Awaiting qualifiers';
  const journeyLabel = fixture.journey_secret ? 'Surprise Journey' : fixture.journey_character_slug ? fixture.journey_character_slug.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ').replace('Adam Eve', 'Adam & Eve').replace('Daniel Nebuchadnezzar', 'Daniel & Nebuchadnezzar') : 'Journey Trivia';
  const live=fixture.room_status==='playing'&&!fixture.result;
  const scoreById=new Map((livePlayers||[]).map(p=>[p.user_id,arenaPlayerScore(p)]));
  const highest=scoreById.size?Math.max(...scoreById.values()):0;
  const placeholders = fixture.duel ? fixture.stage === 'semi' ? ['Second-place tent', 'Third-place tent'] : ['Group leader', 'Semifinal winner'] : fixture.stage === 'semi' ? ['Laurel #1', 'Spades #1', 'Square #1'] : ['Semifinal #1', 'Semifinal #2'];
  // A paired tent is HOME and a solo tent is AWAY. In three-tent fixtures
  // the paired side occupies the middle position to balance the slide.
  const pairedSide = fixture.sides.length === 3 ? fixture.sides.find(side => side.players.length === 2) : undefined;
  const otherSides = fixture.sides.filter(side => side !== pairedSide);
  const displayedSides = pairedSide ? [otherSides[0], pairedSide, ...otherSides.slice(1)] : fixture.sides;
  const matchLabel = displayedSides.length ? displayedSides.map(side=>side.players.map(p=>formatPlayerNumber(p.player_number)).join(' & ')).join(' vs ') : interTentMatchLabel(fixture);
  const timing=<><div className={`flex flex-wrap items-center justify-center gap-1.5 text-center font-semibold text-ink ${compact?'text-[11px]':'text-xs'}`}><CalendarClock size={compact?12:15} className="text-gold" /><time dateTime={fixture.planned_at}>{dateLabel(fixture.planned_at)}</time><span className="text-[10px] text-stone">Cameroon time</span></div><FixtureCountdown plannedAt={fixture.planned_at} draft={draft} live={live} completed={Boolean(fixture.result)||['expired','cancelled','completed'].includes(fixture.room_status||'')} compact={compact}/></>;
  return <article data-artwork-theme={arenaImage?.url ? 'night' : undefined} className={`${compact?'intertent-welcome-glass rounded-2xl':'card'} relative min-w-0 overflow-hidden p-3 sm:p-4`} aria-label={`Match ${fixture.sequence}: ${matchLabel}`}>
    <PanelImageBackdrop image={arenaImage} opacityFallback={22} veilClassName="arena-panel-veil" />
    <div className="relative z-10 space-y-3">
      {compact?<p className="eyebrow text-gold">Journey Trivia · {journeyLabel}</p>:<header className="flex flex-wrap items-start justify-between gap-2">
        <div><p className="eyebrow text-gold">Journey Trivia · {journeyLabel}</p><h5 className="mt-1 font-display text-sm font-bold text-ink">Match {fixture.sequence} · {interTentLegLabel(fixture)}</h5></div>
        <span className={`badge text-[10px] ${fixture.room_status === 'playing' ? 'text-coral' : fixture.result ? 'text-sage' : 'text-stone'}`}>{status}</span>
      </header>}
      {!compact&&timing}
      <div className="flex min-w-0 items-stretch justify-center gap-1 sm:gap-3">
        {displayedSides.length ? displayedSides.map((side, index) => {
          const symbol = houseId(side.tent_name);
          const result = fixture.result?.find(row => row.tent_id === side.tent_id);
          return <div key={side.tent_id} className="contents">
            {index > 0 && <span className="flex shrink-0 items-center self-center text-gold" aria-label="versus"><Swords size={16} /></span>}
            <div className={`flex min-w-0 flex-1 flex-col items-center gap-2 rounded-lg p-2 text-center ${compact?'intertent-welcome-side':'border border-border bg-surface/55'}`}>
              <div className="flex min-w-0 flex-wrap items-center justify-center gap-1.5">{symbol && <TentHouseSymbol houseId={symbol} size={23}/>}<span className="break-words text-[10px] font-bold text-stone">{side.tent_name}</span>{fixture.stage!=='final'&&<span className="rounded-full border border-gold/25 px-1.5 py-0.5 text-[9px] font-bold text-gold">{fixture.home_tent_id?side.tent_id===fixture.home_tent_id?'HOME':'AWAY':side.players.length>=2?'HOME':'AWAY'}</span>}</div>
              <div className="flex flex-wrap justify-center gap-1.5">{side.players.map(player => <div key={player.id} className="flex min-w-0 flex-col items-center gap-1" title={player.name}><UserAvatar userId={player.id} name={player.name} avatarUrl={avatars[player.id]} className={`${compact?'h-8 w-8':'h-10 w-10 sm:h-12 sm:w-12'} shrink-0 border border-gold/35`} /><span className="font-display text-sm font-bold tabular-nums text-ink">{formatPlayerNumber(player.player_number)}</span>{live&&<span className={`font-display text-lg font-black tabular-nums ${scoreById.has(player.id)&&scoreById.get(player.id)===highest&&highest>0?'text-gold':'text-ink'}`} aria-label={`Live score ${scoreById.has(player.id)?scoreById.get(player.id):'loading'}`}>{scoreById.get(player.id)??'—'}</span>}</div>)}</div>
              {result && <p className="font-display text-base font-bold text-gold tabular-nums">{result.points} pts</p>}
            </div>
          </div>;
        }) : placeholders.map((name, index) => <div className="contents" key={name}>{index > 0 && <Swords size={16} className="shrink-0 self-center text-gold" aria-label="versus" />}<div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border p-3 text-center"><Trophy size={22} className="text-gold"/><span className="break-words text-xs font-bold text-ink">{name}</span></div></div>)}
      </div>
      {fixture.result && fixture.room_id && !compact && (
        <div className="mt-3" aria-label="Completed match final scorecard">
          <ArenaFinalScorecard roomId={fixture.room_id} arenaImage={arenaImage} />
        </div>
      )}
      {(canOpen || children) && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
        {canOpen && onShare && <button type="button" className="btn-ghost h-9 w-9 shrink-0 p-0" title="Share Arena match" aria-label="Share Arena match" onClick={onShare}><Share2 size={15}/></button>}
        {canOpen && <button type="button" className={participant ? 'btn-primary text-xs' : 'btn-secondary text-xs'} onClick={onOpen}>{participant ? <Play size={14}/> : <Eye size={14}/>} {participant ? 'Enter Match' : 'Witness'}</button>}
        {children}
      </footer>}
      {compact&&<div className="space-y-1 border-t border-white/15 pt-2">{timing}</div>}
    </div>
  </article>;
}
