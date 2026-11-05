import { supabase } from './supabase';
import type { PuzzleDifficulty, PuzzleBoard } from './puzzleTrivia';
export type PuzzleServerWord = PuzzleBoard['words'][number] & { length: number; clue: string | null; reference: string | null; aid: {used?:string[];answer?:string;firstLetter?:string;eliminated?:number[]} };
export type PuzzleServerState = {
 id?:string; ready?:boolean; level:number; difficulty:PuzzleDifficulty; deadline?:string; found?:string[];
 completed?:boolean; pack?:{title:string;letters:string}; board?:Omit<PuzzleBoard,'words'> & {words:PuzzleServerWord[]};
 figs?:number;reward?:number;notice?:string;
};
export async function puzzleCommand(action:string,args:Record<string,unknown>={}) {
 const {data,error}=await supabase.rpc('puzzle_trivia_command',{p_action:action,...args});
 if(error)throw error;
 window.dispatchEvent(new Event('full-circle:game-activity'));
 return data as PuzzleServerState;
}
export type PreludeCard={slot:number;number?:number;symbol?:string;joker?:boolean};
export type PreludeMove={id:number;playerId:string;card:PreludeCard;at:string};
export type PreludePlayer={id:string;name:string;avatar?:string;cards:number;correct:number;collected?:PreludeCard[]};
export type PreludeState={id:string;name:string;creatorId:string;phase:'waiting'|'playing'|'question'|'completed';difficulty:'easy'|'hard';version:number;moves?:PreludeMove[];players:PreludePlayer[];cards:PreludeCard[];board:PreludeCard[];turn:number;deadline?:string;startsAt?:string;machine:boolean;maxPlayers:number;winnerId?:string;reward?:number;notice?:string;pending?:{number:number;multiple:boolean;scribeSelection?:number[]|null;scribeCorrect?:boolean|null;options:{id:number;text:string}[]}};
export async function preludeCommand(action:string,args:Record<string,unknown>={}) {
 const {data,error}=await supabase.rpc('prelude_command',{p_action:action,...args});
 if(error)throw error;
 return data;
}

export async function forfeitPrelude(roomId: string) {
 const { error } = await supabase.rpc('forfeit_prelude_game', { p_room_id: roomId });
 if (error) throw error;
 window.dispatchEvent(new Event('full-circle:game-activity'));
}
