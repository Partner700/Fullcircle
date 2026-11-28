/** Authoritative duel rules. Membership and witness presence must be loaded by the server. */
import type { JourneyRuntime } from './biblicalJourneyRuntime.ts';
export const SPIRIT_ASSISTANCE_LIMIT = 3;
export type DuelStage = 'group' | 'semi' | 'final';
export type DuelSide = { tentId: string; representativeId: string; substitutions: number };
export type Spirit = { userId: string; assists: number; requestedQuestionId: string | null };
export type Duel = { stage: DuelStage; home: DuelSide; away: DuelSide; spirit: Spirit | null; status: 'waiting' | 'playing' | 'completed' };
export type Member = { userId: string; tentId: string; role: 'cadet' | 'sentry' | 'instructor' | 'admin'; witnessing: boolean };

export function buildDuelGroupSchedule(tents: readonly string[], firstTuesday: string) {
  if (tents.length !== 3 || new Set(tents).size !== 3 || tents.some(t => !t)) throw new Error('Three distinct tents are required.');
  const start = new Date(`${firstTuesday}T00:00:00Z`);
  if (!Number.isFinite(start.getTime()) || start.getUTCDay() !== 2 || start.toISOString().slice(0, 10) !== firstTuesday) throw new Error('Choose a Tuesday.');
  const [a,b,c] = tents;
  // Four meetings per pairing, two at home and two away; every tent plays eight times.
  const pairings = [[a,b],[b,c],[c,a],[b,a],[c,b],[a,c],[a,b],[b,c],[c,a],[b,a],[c,b],[a,c]];
  return pairings.map(([home,away], index) => ({home,away,stage:'group' as const,sequence:index+1,
    startsAt:`${new Date(start.getTime()+(Math.floor(index/4)*7+index%4)*86400000).toISOString().slice(0,10)}T18:00:00+01:00`}));
}

export function qualifyDuelTents(rows: readonly {tentId:string; points:number; score:number; answers:number}[]) {
  const ordered = [...rows].sort((a,b)=>b.points-a.points || b.score-a.score || b.answers-a.answers || a.tentId.localeCompare(b.tentId));
  if (ordered.length !== 3 || new Set(ordered.map(row=>row.tentId)).size !== 3) throw new Error('Three tent standings are required.');
  return {finalist:ordered[0].tentId, semifinal:[ordered[1].tentId,ordered[2].tentId] as const};
}

function open(duel:Duel) { if(duel.status==='completed') throw new Error('The duel has ended.'); }
function eligibleCadet(member:Member, tentId:string) {
  if (member.role!=='cadet' || member.tentId!==tentId) throw new Error('Choose a resident from the same tent.');
}

export function chooseSpirit(duel:Duel, actorId:string, witness:Member):Duel {
  open(duel);
  if(duel.stage==='final' || actorId!==duel.home.representativeId || duel.spirit) throw new Error('Spirit selection is unavailable.');
  eligibleCadet(witness,duel.home.tentId);
  if(!witness.witnessing || [duel.home.representativeId,duel.away.representativeId].includes(witness.userId)) throw new Error('Choose an eligible witness.');
  return {...duel,spirit:{userId:witness.userId,assists:0,requestedQuestionId:null}};
}

export function requestSpiritHelp(duel:Duel,actorId:string,questionId:string,currentQuestionPlayerId:string):Duel {
  if(duel.status!=='playing'||duel.stage==='final'||actorId!==duel.home.representativeId||currentQuestionPlayerId!==actorId||!questionId||!duel.spirit||duel.spirit.assists>=SPIRIT_ASSISTANCE_LIMIT) throw new Error('Spirit assistance is unavailable.');
  return {...duel,spirit:{...duel.spirit,requestedQuestionId:questionId}};
}

/** Call in the same transaction as the successful answer or relic commit. */
export function consumeSpiritHelp(duel:Duel,actor:Member,kind:'answer'|'relic',questionId:string,currentQuestionPlayerId:string):Duel {
  const spirit=duel.spirit;
  if(duel.status!=='playing'||duel.stage==='final'||!spirit||spirit.userId!==actor.userId||spirit.assists>=SPIRIT_ASSISTANCE_LIMIT||!actor.witnessing||currentQuestionPlayerId!==duel.home.representativeId||!questionId) throw new Error('Spirit assistance is unavailable.');
  eligibleCadet(actor,duel.home.tentId);
  if(kind==='answer'&&spirit.requestedQuestionId!==questionId) throw new Error('The representative must request help for this question.');
  return {...duel,spirit:{...spirit,assists:spirit.assists+1,requestedQuestionId:kind==='answer'?null:spirit.requestedQuestionId}};
}

/** Caller must atomically transfer the existing seat, not create a new game. */
export function substituteDuelRepresentative(duel:Duel,sentry:Member,replacement:Member):Duel {
  open(duel);
  if(sentry.role!=='sentry') throw new Error('Only the tent sentry can substitute.');
  const side=sentry.tentId===duel.home.tentId?'home':sentry.tentId===duel.away.tentId?'away':null;
  if(!side||duel[side].substitutions>=1) throw new Error('No substitution is available.');
  eligibleCadet(replacement,duel[side].tentId);
  if([duel.home.representativeId,duel.away.representativeId,duel.spirit?.userId].includes(replacement.userId)) throw new Error('Choose another eligible resident.');
  return {...duel,[side]:{...duel[side],representativeId:replacement.userId,substitutions:duel[side].substitutions+1},spirit:side==='home'&&duel.spirit?{...duel.spirit,requestedQuestionId:null}:duel.spirit};
}

/** Transfer a server-owned Journey seat. The DB must atomically replace the roster and commit this state. */
export function transferDuelJourneySeat(runtime:JourneyRuntime,outgoing:string,incoming:string):JourneyRuntime {
  if(runtime.game.status!=='playing'||runtime.game.players.length>2||!runtime.game.players.some(p=>p.id===outgoing&&p.forfeitedPoints===undefined)||runtime.game.players.some(p=>p.id===incoming)||!incoming) throw new Error('The Journey seat cannot be transferred.');
  // Remap active references, including delayed effects, shield decisions, skip counters and Undo snapshots.
  // Keep historical event records intact; they describe the resident who actually performed the action.
  const remap=(value:unknown):unknown=>{
    if(value===outgoing)return incoming;
    if(Array.isArray(value))return value.map(remap);
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k===outgoing?incoming:k,remap(v)]));
    return value;
  };
  const next=remap(runtime) as JourneyRuntime;
  next.game.events=structuredClone(runtime.game.events);
  next.lastVerdict=structuredClone(runtime.lastVerdict);
  if(next.undo&&runtime.undo)next.undo.before.events=structuredClone(runtime.undo.before.events);
  next.game.version=runtime.game.version+1;
  return next;
}
