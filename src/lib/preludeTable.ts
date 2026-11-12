export const PRELUDE_RING = [
  {row:0,col:0},{row:0,col:1},{row:0,col:2},{row:1,col:2},
  {row:2,col:2},{row:2,col:1},{row:2,col:0},{row:1,col:0},
] as const;
export function preludeStacks<T extends {slot:number}>(cards:readonly T[]) {
 const stacks:T[][]=Array.from({length:8},()=>[]);
 for(const card of cards)stacks[card.slot%8].push(card);
 return stacks;
}
