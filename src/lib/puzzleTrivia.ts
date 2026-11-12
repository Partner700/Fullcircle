export type PuzzleDifficulty = 'easy' | 'medium' | 'hard';
export type PuzzleWord = { word: string; category: 'Person' | 'Place' | 'Object'; clue: string; reference: string };
export type PuzzlePack = { id: string; title: string; letters: string; words: PuzzleWord[] };
const person = (word: string, clue: string, reference: string): PuzzleWord => ({ word, category: 'Person', clue, reference });
const place = (word: string, clue: string, reference: string): PuzzleWord => ({ word, category: 'Place', clue, reference });
const object = (word: string, clue: string, reference: string): PuzzleWord => ({ word, category: 'Object', clue, reference });
// Curated from the same Scripture narratives used by Biblical Journey.
// Each answer is a person, named place, or tangible object; no filler dictionary words.
export const PUZZLE_PACKS: PuzzlePack[] = [
 { id: 'abraham', title: 'Abraham: the promise', letters: 'ABRAHAM', words: [person('ABRAHAM','God promised to make him the father of many nations.','Genesis 17:5'),person('RAHAB','She hid the spies in Jericho.','Joshua 2:1–6'),person('HAM','One of Noah’s three sons.','Genesis 9:18'),place('ARAM','The land where Jacob went to find a wife.','Genesis 28:5'),place('MARAH','Israel found bitter water here after crossing the sea.','Exodus 15:23'),object('RAM','Abraham offered this in place of Isaac.','Genesis 22:13')] },
 { id: 'jonathan', title: 'David: friendship and courage', letters: 'JONATHAN', words: [person('JONATHAN','Saul’s son who made a covenant of friendship with David.','1 Samuel 18:1–4'),person('NATHAN','The prophet who confronted David with a story about a lamb.','2 Samuel 12:1–7'),person('JOHN','The disciple described as the one Jesus loved.','John 21:20–24'),person('NOAH','He built an ark before the flood.','Genesis 6:13–22'),person('ANNA','An elderly prophetess who saw the infant Jesus in the temple.','Luke 2:36–38'),person('JONAH','A prophet sent to Nineveh.','Jonah 1:1–2')] },
 { id: 'samaria', title: 'Israel: kings and places', letters: 'SAMARIA', words: [place('SAMARIA','Omri built this city as a royal capital.','1 Kings 16:24'),place('ARAM','Naaman came from this land.','2 Kings 5:1'),place('ASIA','Paul taught so that people throughout this province heard the word.','Acts 19:10'),person('AMASA','David appointed him to lead the army instead of Joab.','2 Samuel 19:13'),person('ASA','A king of Judah who removed foreign altars.','2 Chronicles 14:2–3'),object('RAM','A male sheep used as an offering.','Leviticus 5:15')] },
 { id: 'jerusalem', title: 'Jesus and the holy city', letters: 'JERUSALEM', words: [place('JERUSALEM','The city where Jesus was crucified and rose again.','Luke 24:18–24'),person('SAMUEL','The boy who heard God calling during the night.','1 Samuel 3:1–10'),person('JAMES','A son of Zebedee and brother of John.','Matthew 4:21'),person('SAUL','Israel’s first king.','1 Samuel 10:1'),person('ESAU','Jacob’s older twin brother.','Genesis 25:24–26'),place('ELAM','People from this land heard the disciples at Pentecost.','Acts 2:9'),object('RAM','The substitute found in a thicket on Mount Moriah.','Genesis 22:13')] },
 { id: 'tabernacle', title: 'Moses: worship in the wilderness', letters: 'TABERNACLE', words: [object('TABERNACLE','Israel’s portable sanctuary in the wilderness.','Exodus 25:8–9'),object('ALTAR','A structure on which offerings were presented.','Exodus 27:1'),place('CANA','Jesus turned water into wine in this village.','John 2:1–11'),person('ABEL','He brought an offering from his flock.','Genesis 4:4'),person('ABNER','The commander of Saul’s army.','1 Samuel 14:50'),person('NABAL','Abigail’s husband who insulted David’s men.','1 Samuel 25:3–11'),object('BAAL','The false god represented by idols opposed by Elijah.','1 Kings 18:21–26')] },
 { id: 'jordan', title: 'Joshua: crossing into promise', letters: 'JORDAN', words: [place('JORDAN','Israel crossed this river on dry ground.','Joshua 3:14–17'),person('DAN','A son of Jacob and Bilhah.','Genesis 30:6'),place('DOR','A coastal city mentioned among Manasseh’s towns.','Joshua 17:11'),object('JAR','A container the widow used for oil.','2 Kings 4:2'),object('ROD','Aaron’s staff blossomed as a sign of God’s choice.','Numbers 17:8')] },
 { id: 'goliath', title: 'David: the giant and the shepherd', letters: 'GOLIATH', words: [person('GOLIATH','The Philistine champion defeated by David.','1 Samuel 17:4–50'),place('GATH','The home city of the Philistine champion.','1 Samuel 17:4'),person('LOT','Abraham’s nephew who lived in Sodom.','Genesis 13:12')] },
 { id: 'sapphira', title: 'Acts: truth and integrity', letters: 'SAPPHIRA', words: [person('SAPPHIRA','She and Ananias lied about the sale of their property.','Acts 5:1–10'),person('SARAH','Isaac’s mother.','Genesis 21:1–3'),place('PARAH','A town listed in Benjamin’s territory.','Joshua 18:23'),person('RAPHA','A son of Benjamin named in his family genealogy.','1 Chronicles 8:2'),object('SHIP','Paul travelled in one of these before the wreck near Malta.','Acts 27:41–44')] },
 { id: 'rebekah', title: 'Isaac: a family of promise', letters: 'REBEKAH', words: [person('REBEKAH','She gave water to Abraham’s servant and his camels.','Genesis 24:15–20'),person('HEBER','A Kenite whose wife was Jael.','Judges 4:17'),place('BEER','A place where Israel gathered for water.','Numbers 21:16'),object('ARK','The sacred chest carried by Israel.','Joshua 3:6')] },
 { id: 'mordecai', title: 'Esther: courage in exile', letters: 'MORDECAI', words: [person('MORDECAI','Esther’s cousin who raised her as his daughter.','Esther 2:7'),place('MEDIA','A kingdom named alongside Persia.','Esther 1:3'),place('ROME','Paul arrived here under guard.','Acts 28:16'),place('DOR','A coastal town within Manasseh’s allotted territory.','Joshua 17:11'),person('OMAR','A son of Eliphaz in Esau’s family.','Genesis 36:11'),object('ROD','Moses carried this when God sent him to Egypt.','Exodus 4:17')] },
 { id: 'candlestick', title: 'The sanctuary: light and service', letters: 'CANDLESTICK', words: [object('CANDLESTICK','The KJV name for the sanctuary’s golden lampstand.','Exodus 25:31'),person('DANIEL','He continued praying even when a royal decree forbade it.','Daniel 6:10'),person('CAIN','Adam and Eve’s son who killed Abel.','Genesis 4:1–8'),object('NAILS','Thomas wanted to see the marks left by these.','John 20:25'),object('STICK','Ezekiel joined two of these as a sign for Israel.','Ezekiel 37:16–17'),object('TACKLE','The ship’s equipment thrown overboard during Paul’s storm.','Acts 27:19'),person('DAN','A son of Jacob whose name means judgment.','Genesis 30:6')] },
 { id: 'pharaoh', title: 'Exodus: freedom and deliverance', letters: 'PHARAOH', words: [person('PHARAOH','The ruler who refused Moses’ request to let Israel go.','Exodus 5:1–2'),object('HARP','David played this instrument for Saul.','1 Samuel 16:23'),place('PARAH','A town included in Benjamin’s inheritance.','Joshua 18:23')] },
];
export const PUZZLE_DIFFICULTIES = {
 easy: { label: 'Easy', seconds: 240, wordCount: 3, detail: 'Familiar words · full clues · 4 minutes' },
 medium: { label: 'Medium', seconds: 180, wordCount: 4, detail: 'Longer words · Scripture clues · 3 minutes' },
 hard: { label: 'Hard', seconds: 120, wordCount: 6, detail: 'Less obvious words · hidden clues · 2 minutes' },
} as const;
export type PuzzleCell = { row: number; col: number; letter: string; wordIndexes: number[] };
export type PlacedPuzzleWord = PuzzleWord & { row: number; col: number; vertical: boolean };
export type PuzzleBoard = { cells: PuzzleCell[]; words: PlacedPuzzleWord[]; rows: number; cols: number };
export function canBuildPuzzleWord(word: string, letters: string): boolean {
 const pool=letters.split('');
 for(const letter of word) { const index=pool.indexOf(letter); if(index<0)return false;pool.splice(index,1); }
 return true;
}
export function buildPuzzleBoard(input: PuzzleWord[]): PuzzleBoard {
 const words: PlacedPuzzleWord[]=[]; const cells=new Map<string,PuzzleCell>();
 const key=(r:number,c:number)=>`${r},${c}`;
 const add=(word:PuzzleWord,row:number,col:number,vertical:boolean)=>{
  const index=words.length; words.push({...word,row,col,vertical});
  [...word.word].forEach((letter,i)=>{const r=row+(vertical?i:0),c=col+(vertical?0:i);const cell=cells.get(key(r,c));if(cell)cell.wordIndexes.push(index);else cells.set(key(r,c),{row:r,col:c,letter,wordIndexes:[index]});});
 };
 const sorted=[...input].sort((a,b)=>b.word.length-a.word.length);
 if(!sorted.length)return {cells:[],words:[],rows:0,cols:0};
 add(sorted[0],0,0,false);
 const pending=sorted.slice(1);
 for(let pass=0;pass<input.length && pending.length;pass++) {
  let changed=false;
  for(let n=0;n<pending.length;n++) {
   const word=pending[n]; let best:{row:number;col:number;vertical:boolean;score:number}|null=null;
   for(const cross of cells.values()) for(let i=0;i<word.word.length;i++) {
    if(word.word[i]!==cross.letter)continue;
    for(const vertical of [true,false]) {
     const row=cross.row-(vertical?i:0),col=cross.col-(vertical?0:i),dr=vertical?1:0,dc=vertical?0:1;
     if(cells.has(key(row-dr,col-dc))||cells.has(key(row+dr*word.word.length,col+dc*word.word.length)))continue;
     let valid=true,intersections=0;
     for(let j=0;j<word.word.length;j++) {
      const r=row+dr*j,c=col+dc*j,cell=cells.get(key(r,c));
      if(cell) {if(cell.letter!==word.word[j]||cell.wordIndexes.some(index=>words[index].vertical===vertical)){valid=false;break;}intersections++;}
      else if(cells.has(key(r-dc,c-dr))||cells.has(key(r+dc,c+dr))){valid=false;break;}
     }
     if(!valid)continue;
     const rs=[...cells.values()].map(c=>c.row).concat([row,row+dr*(word.word.length-1)]),cs=[...cells.values()].map(c=>c.col).concat([col,col+dc*(word.word.length-1)]);
     const height=Math.max(...rs)-Math.min(...rs)+1,width=Math.max(...cs)-Math.min(...cs)+1;
     if(width>13||height>15)continue;
     const score=height*width+Math.abs(width-height)*2-intersections*4;
     if(!best||score<best.score)best={row,col,vertical,score};
    }
   }
   if(best){add(word,best.row,best.col,best.vertical);pending.splice(n--,1);changed=true;}
  }
  if(!changed)break;
 }
 const all=[...cells.values()];const minR=Math.min(...all.map(c=>c.row)),minC=Math.min(...all.map(c=>c.col));
 return {cells:all.map(c=>({...c,row:c.row-minR,col:c.col-minC})),words:words.map(w=>({...w,row:w.row-minR,col:w.col-minC})),rows:Math.max(...all.map(c=>c.row))-minR+1,cols:Math.max(...all.map(c=>c.col))-minC+1};
}
export function puzzleForLevel(level:number,difficulty:PuzzleDifficulty): {pack:PuzzlePack;board:PuzzleBoard} {
 const pack=PUZZLE_PACKS[((level%PUZZLE_PACKS.length)+PUZZLE_PACKS.length)%PUZZLE_PACKS.length];
 const sorted=[...pack.words].sort((a,b)=>difficulty==='easy'?a.word.length-b.word.length:b.word.length-a.word.length);
 const chosen=sorted.slice(0,PUZZLE_DIFFICULTIES[difficulty].wordCount);
 let board=buildPuzzleBoard(chosen);
 if(board.words.length<Math.min(3,chosen.length))board=buildPuzzleBoard(pack.words);
 return {pack,board};
}
