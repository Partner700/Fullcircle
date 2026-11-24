import assert from 'node:assert/strict';
import {PUZZLE_PACKS,canBuildPuzzleWord,puzzleForLevel,type PuzzleDifficulty} from '../src/lib/puzzleTrivia.ts';
assert.equal(canBuildPuzzleWord('ANNA','JONATHAN'),true);
assert.equal(canBuildPuzzleWord('ANNA','JONATHA'),false);
for(const pack of PUZZLE_PACKS)for(const entry of pack.words) {
 assert.ok(canBuildPuzzleWord(entry.word,pack.letters),`${pack.id}: ${entry.word} exceeds the wheel's letters`);
 assert.match(entry.word,/^[A-Z]+$/); assert.ok(entry.reference && entry.clue);
}
for(const difficulty of ['easy','medium','hard'] as PuzzleDifficulty[])for(let level=0;level<PUZZLE_PACKS.length;level++) {
 const {pack,board}=puzzleForLevel(level,difficulty);
 assert.ok(board.words.length>=3,`${pack.id}/${difficulty} has fewer than three connected words`);
 assert.ok(board.cols<=13 && board.rows<=15);
 const positions=new Map(board.cells.map(c=>[`${c.row},${c.col}`,c]));
 for(const [index,word] of board.words.entries()) {
  [...word.word].forEach((letter,i)=>{const cell=positions.get(`${word.row+(word.vertical?i:0)},${word.col+(word.vertical?0:i)}`);assert.equal(cell?.letter,letter);assert.ok(cell?.wordIndexes.includes(index));});
  if(index>0)assert.ok(board.cells.some(c=>c.wordIndexes.includes(index)&&c.wordIndexes.some(n=>n<index)),`${pack.id} has a detached word`);
 }
}
console.log('Puzzle Trivia: all Bible words fit their wheels; all 36 difficulty/pack boards connect, cross correctly, and fit mobile bounds.');
