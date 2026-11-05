import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const {PGlite}=await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db=new PGlite();
const migration=readFileSync(new URL('../supabase/migrations/20261103152901_puzzle_rewards_and_prelude.sql',import.meta.url),'utf8');
const uid='00000000-0000-4000-8000-000000000001', other='00000000-0000-4000-8000-000000000002';
const query=async(sql,args=[])=> (await db.query(sql,args)).rows;
const puzzle=async(action,args={})=>(await query(`select public.puzzle_trivia_command($1,$2,$3,$4,$5,$6,$7) s`,[action,args.id||null,args.difficulty||'easy',args.level||0,args.word||null,args.target||0,args.relic||null]))[0].s;
const prelude=async(action,args={})=>(await query(`select public.prelude_command($1,$2,$3,$4,$5,$6,$7,$8) s`,[action,args.id||null,args.slot??null,args.answers||[],args.version??null,args.difficulty||'easy',args.machine||false,'Test Prelude']))[0].s;
try{
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('app.uid',true),'')::uuid$$;
 CREATE TABLE profiles(id uuid PRIMARY KEY,display_name text,avatar_url text);
 CREATE TABLE relic_types(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),slug text);
 CREATE TABLE relic_inventory(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,relic_type_id uuid,quantity int);
 CREATE TABLE relic_usage_log(user_id uuid,relic_type_id uuid,effect_applied text);
 CREATE TABLE denarii_ledger_entries(user_id uuid,amount int,source_type text,source_reference text,description text);
 CREATE TABLE puzzle_trivia_activity(user_id uuid PRIMARY KEY);
 CREATE TABLE arena_rooms(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),creator_id uuid,room_name text,stake_amount int,max_players int,status text,game_call_fee int,play_mode text,expires_at timestamptz,created_at timestamptz DEFAULT now(),started_at timestamptz,completed_at timestamptz,winner_id uuid,machine_score int);
 CREATE TABLE arena_participants(room_id uuid,user_id uuid,stake_paid boolean,score int,correct_count int,finished_at timestamptz,joined_at timestamptz DEFAULT now(),forfeited_at timestamptz,PRIMARY KEY(room_id,user_id));
 CREATE TABLE arena_scheduled_matches(room_id uuid PRIMARY KEY,player_ids uuid[],starts_at timestamptz);
 INSERT INTO profiles VALUES('${uid}','First',NULL),('${other}','Second',NULL);`);
 await db.exec(migration.split('ALTER TABLE public.arena_tournaments DROP CONSTRAINT')[0]);
 await db.exec(readFileSync(new URL('../supabase/migrations/20261103192202_prelude_ten_second_stacked_table.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../supabase/migrations/20261104060919_prelude_scribe_turns.sql',import.meta.url),'utf8'));
 await db.exec('ALTER TABLE public.arena_rooms ADD COLUMN completion_reason text; ALTER TABLE public.arena_participants ADD COLUMN forfeit_reason text;');
 await db.exec(readFileSync(new URL('../supabase/migrations/20261105184650_prelude_forfeit.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../supabase/migrations/20261105201641_puzzle_owned_relics.sql',import.meta.url),'utf8'));
 await query("select set_config('app.uid',$1,false)",[uid]);
 let r=await puzzle('start');assert.equal(r.board.words.length,3);assert.ok(r.board.words.every(w=>!w.word&&!w.reference));
 const words=(await query("select payload->'board'->'words' words from scripture_games.puzzle_catalog where level=0 and difficulty='easy'"))[0].words;
 let invalid=await puzzle('answer',{id:r.id,word:'NOTAWORD'});assert.equal(invalid.figs,0);
 r=await puzzle('answer',{id:r.id,word:words[0].word});assert.equal(r.figs,1);
 r=await puzzle('answer',{id:r.id,word:words[0].word});assert.equal(r.figs,1);
 await db.exec(`INSERT INTO relic_types(slug) VALUES('reveal-reference'),('skip'),('freeze-timer');INSERT INTO relic_inventory(user_id,relic_type_id,quantity) SELECT '${uid}',id,2 FROM relic_types;`);
 r=await puzzle('relic',{id:r.id,relic:'reveal-reference',target:0});assert.ok(r.board.words[0].reference);assert.equal(r.board.words[1].reference,null);
 await puzzle('relic',{id:r.id,relic:'reveal-reference',target:0});assert.equal((await query("select quantity from relic_inventory join relic_types on relic_type_id=relic_types.id where slug='reveal-reference'"))[0].quantity,1);
 r=await puzzle('relic',{id:r.id,relic:'skip',target:1});assert.equal(r.figs,1);
 r=await puzzle('answer',{id:r.id,word:words[2].word});assert.equal(r.completed,true);assert.equal(r.figs,2);
 await puzzle('answer',{id:r.id,word:words[2].word});assert.equal((await query('select sum(amount) n from denarii_ledger_entries'))[0].n,500);
 await query("select set_config('app.uid',$1,false)",[other]);await assert.rejects(puzzle('answer',{id:r.id,word:words[0].word}),/not found/);
 await query("select set_config('app.uid',$1,false)",[uid]);
 let g=await prelude('create');await query("select set_config('app.uid',$1,false)",[other]);await prelude('join',{id:g.id});await query("select set_config('app.uid',$1,false)",[uid]);g=await prelude('start',{id:g.id});assert.equal(g.cards.length,103);assert.equal(g.board.length,1);assert.ok(g.cards.every(c=>Object.keys(c).length===1));
 const privateState=(await query('select state from scripture_games.prelude_games where room_id=$1',[g.id]))[0].state;
 assert.equal(privateState.deck.length,104);assert.equal(privateState.deck.filter(c=>c.joker).length,4);
 let match=privateState.deck.find(c=>!c.drawn&&!c.joker&&(c.number===g.board[0].number||c.symbol===g.board[0].symbol));
 g=await prelude('flip',{id:g.id,slot:match.slot,version:g.version});assert.equal(g.phase,'question');assert.ok(!('correct' in g.pending));
 assert.ok(new Date(g.deadline).getTime()-Date.now()<=10000 && new Date(g.deadline).getTime()-Date.now()>9000);
 assert.equal(g.moves.at(-1).card.slot,match.slot);
 assert.ok(!g.cards.some(card=>card.slot===match.slot));
 let correct=(await query("select state->'pending'->'correct' answer from scripture_games.prelude_games where room_id=$1",[g.id]))[0].answer;
 let stale=await prelude('answer',{id:g.id,answers:correct,version:g.version-1});assert.equal(stale.phase,'question');
 g=await prelude('answer',{id:g.id,answers:correct,version:g.version});assert.equal(g.players[0].cards,2);assert.equal(g.players[0].collected.length,2);assert.equal(g.board.length,1);
 await assert.rejects(prelude('flip',{id:g.id,slot:g.cards[0].slot,version:g.version}),/Wait/);
 await query("select set_config('app.uid',$1,false)",[other]);
 let deck=(await query('select state from scripture_games.prelude_games where room_id=$1',[g.id]))[0].state.deck;
 let miss=deck.find(c=>!c.drawn&&!c.joker&&c.number!==g.board[0].number&&c.symbol!==g.board[0].symbol);
 g=await prelude('flip',{id:g.id,slot:miss.slot,version:g.version});assert.equal(g.board.at(-1).slot,miss.slot);assert.equal(g.turn,0);
 await query("select set_config('app.uid',$1,false)",[uid]);
 let joker=deck.find(c=>!c.drawn&&c.joker);g=await prelude('flip',{id:g.id,slot:joker.slot,version:g.version});assert.equal(g.players[0].cards,5);assert.equal(g.players[0].collected.length,5);
 assert.equal(new Set(g.players[0].collected.map(card=>card.slot)).size,5);
 await assert.rejects(query("select scripture_games.prelude_finish($1,state) from scripture_games.prelude_games where room_id=$1",[g.id]),/Use every closed card/);
 // Force only one face-down card to exercise real settlement without 104 manual turns.
 let state=(await query('select state from scripture_games.prelude_games where room_id=$1',[g.id]))[0].state;
 state.turn=0;state.deck=state.deck.map(c=>({...c,drawn:true}));let last=state.deck.find(c=>c.joker);last.drawn=false;
 await query('update scripture_games.prelude_games set state=$2 where room_id=$1',[g.id,JSON.stringify(state)]);
 g=await prelude('flip',{id:g.id,slot:last.slot,version:g.version});assert.equal(g.phase,'completed');assert.equal(g.winnerId,uid);
 await prelude('state',{id:g.id});assert.equal((await query("select sum(amount) n from denarii_ledger_entries where source_reference like 'prelude:%'"))[0].n,1000);
 // Expiry, no inventory, and freeze are checked by the server.
 let timed=await puzzle('start',{difficulty:'hard'});
 await assert.rejects(puzzle('relic',{id:timed.id,relic:'hint'}),/do not own/);
 let oldDeadline=new Date(timed.deadline).getTime();
 timed=await puzzle('relic',{id:timed.id,relic:'freeze-timer'});assert.equal(new Date(timed.deadline).getTime()-oldDeadline,60000);
 await query("update scripture_games.puzzle_runs set deadline=now()-interval '1 second' where id=$1",[timed.id]);
 await assert.rejects(puzzle('answer',{id:timed.id,word:'ABRAHAM'}),/Time is up/);
 // Hard mode validates the entire answer set, rather than accepting one true option.
 let hard=await prelude('create',{difficulty:'hard'});
 await query("select set_config('app.uid',$1,false)",[other]);await prelude('join',{id:hard.id});
 await query("select set_config('app.uid',$1,false)",[uid]);hard=await prelude('start',{id:hard.id});
 let hs=(await query('select state from scripture_games.prelude_games where room_id=$1',[hard.id]))[0].state;
 let hc=hs.deck.find(c=>!c.drawn&&!c.joker&&c.number!==153&&(c.number===hard.board[0].number||c.symbol===hard.board[0].symbol));
 hard=await prelude('flip',{id:hard.id,slot:hc.slot,version:hard.version});assert.equal(hard.pending.multiple,true);
 let ha=(await query("select state->'pending'->'correct' a from scripture_games.prelude_games where room_id=$1",[hard.id]))[0].a;
 assert.equal(ha.length,2);hard=await prelude('answer',{id:hard.id,answers:[ha[0]],version:hard.version});assert.equal(hard.players[0].cards,0);assert.equal(hard.board.at(-1).slot,hc.slot);
 // A full ten-player lobby accepts ten members and rejects an eleventh.
 let crowded=await prelude('create');
 for(let i=2;i<=11;i++){
  const id=`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`;
  await query('insert into profiles(id,display_name) values($1,$2) on conflict do nothing',[id,`Player ${i}`]);
  await query("select set_config('app.uid',$1,false)",[id]);
  if(i<=10)crowded=await prelude('join',{id:crowded.id});else await assert.rejects(prelude('join',{id:crowded.id}),/accepting/);
 }
 assert.equal(crowded.players.length,10);
 await query("select set_config('app.uid',$1,false)",[other]);
 let machine=await prelude('create',{machine:true});machine=await prelude('start',{id:machine.id});
 let ms=(await query('select state from scripture_games.prelude_games where room_id=$1',[machine.id]))[0].state;
 let mc=ms.deck.find(c=>!c.drawn&&!c.joker&&c.number!==machine.board[0].number&&c.symbol!==machine.board[0].symbol);
 const scribeCard=ms.deck.find(card=>!card.drawn && !card.joker && card.slot!==mc.slot
  && (card.number===mc.number || card.symbol===mc.symbol));
 ms.deck=ms.deck.map(card=>({...card,drawn:card.slot!==mc.slot && card.slot!==scribeCard.slot}));
 await query('update scripture_games.prelude_games set state=$2 where room_id=$1',[machine.id,JSON.stringify(ms)]);
 machine=await prelude('flip',{id:machine.id,slot:mc.slot,version:machine.version});
 assert.equal(machine.phase,'question');
 assert.equal(machine.players[machine.turn].id,'machine');
 assert.equal(machine.cards.length,0);
 assert.equal(machine.pending.scribeSelection,null);
 assert.ok(!('correct' in machine.pending));
 assert.equal((await prelude('state',{id:machine.id})).version,machine.version);
 await query("update scripture_games.prelude_games set state=jsonb_set(state,'{pending,scribeAnswerAt}',to_jsonb(clock_timestamp()-interval '1 second')) where room_id=$1",[machine.id]);
 machine=await prelude('state',{id:machine.id});
 assert.equal(machine.phase,'question');
 assert.ok(machine.pending.scribeSelection.length);
 assert.ok(machine.pending.scribeSelection.every(id=>machine.pending.options.some(option=>option.id===id)));
 assert.equal(typeof machine.pending.scribeCorrect,'boolean');
 assert.equal((await prelude('state',{id:machine.id})).version,machine.version);
 await query("update scripture_games.prelude_games set state=jsonb_set(state,'{pending,scribeRevealUntil}',to_jsonb(clock_timestamp()-interval '1 second')) where room_id=$1",[machine.id]);
 machine=await prelude('state',{id:machine.id});
 assert.equal(machine.phase,'completed');
 console.log('Scribe turn passed: visible question, hidden answer key, visible selection and result before settlement.');
 // Exhaust a complete, unmodified 104-card round and prove conservation after each turn.
 await query("select set_config('app.uid',$1,false)",[other]);
 let full=await prelude('create');
 await query("select set_config('app.uid',$1,false)",[uid]);await prelude('join',{id:full.id});
 await query("select set_config('app.uid',$1,false)",[other]);full=await prelude('start',{id:full.id});
 let used=new Set(full.board.map(card=>card.slot));let turns=0;
 const conserve=state=>{
  const slots=[...state.cards,...state.board,...state.players.flatMap(player=>player.collected||[])].map(card=>card.slot);
  assert.equal(slots.length,104);assert.equal(new Set(slots).size,104);
  assert.ok(state.cards.every(card=>!used.has(card.slot)));
  for(const card of [...state.board,...state.players.flatMap(player=>player.collected||[])])used.add(card.slot);
 };
 conserve(full);
 while(full.phase!=='completed' && turns++<105){
  assert.ok(full.cards.length>0 || full.phase==='question');
  await query("select set_config('app.uid',$1,false)",[full.players[full.turn].id]);
  if(full.phase==='playing')full=await prelude('flip',{id:full.id,slot:full.cards[0].slot,version:full.version});
  if(full.phase==='question'){
   const answers=(await query("select state->'pending'->'correct' a from scripture_games.prelude_games where room_id=$1",[full.id]))[0].a;
   full=await prelude('answer',{id:full.id,answers,version:full.version});
  }
  conserve(full);if(full.cards.length)assert.notEqual(full.phase,'completed');
 }
 assert.equal(full.phase,'completed');assert.equal(full.cards.length,0);assert.ok(turns<=103);
 console.log('Prelude 223 passed: ten-second questions, captured faces, no card reuse, all 104 cards conserved, no early completion, complete deck exhaustion.');


 // Real owned relics are accepted; the Sword clears a level without adding assisted FIGS.
 await query("select set_config('app.uid',$1,false)",[uid]);
 await db.exec("INSERT INTO relic_types(slug) VALUES('sword-goliath'),('talking-donkey'),('witch-ball-endor'); INSERT INTO relic_inventory(user_id,relic_type_id,quantity) SELECT '00000000-0000-4000-8000-000000000001',id,3 FROM relic_types WHERE slug IN ('sword-goliath','talking-donkey','witch-ball-endor');");
 let assisted=await puzzle('start',{difficulty:'medium'});
 await assert.rejects(puzzle('relic',{id:assisted.id,relic:'talking-donkey',word:''}),/Connect letters/);
 const beforeDonkey=(await query("select quantity from relic_inventory i join relic_types t on t.id=i.relic_type_id where i.user_id=$1 and t.slug='talking-donkey'",[uid]))[0].quantity;
 assisted=await puzzle('relic',{id:assisted.id,relic:'talking-donkey',word:'WRONG'});
 assert.match(assisted.notice,/warns/);assert.equal(assisted.board.words[0].aid.answer,undefined);
 assert.equal((await query("select quantity from relic_inventory i join relic_types t on t.id=i.relic_type_id where i.user_id=$1 and t.slug='talking-donkey'",[uid]))[0].quantity,beforeDonkey-1);
 assisted=await puzzle('relic',{id:assisted.id,relic:'witch-ball-endor',target:1});assert.ok(assisted.board.words[1].aid.answer);
 assisted=await puzzle('relic',{id:assisted.id,relic:'skip',target:0});
 assisted=await puzzle('relic',{id:assisted.id,relic:'freeze-timer',target:0});assert.match(assisted.notice,/60 seconds/);
 assisted=await puzzle('relic',{id:assisted.id,relic:'sword-goliath',target:0});assert.equal(assisted.completed,true);assert.equal(assisted.found.length,assisted.board.words.length);assert.equal(assisted.figs,0);assert.equal(assisted.reward,500);
 await puzzle('relic',{id:assisted.id,relic:'sword-goliath',target:0});
 assert.equal((await query("select count(*)::int n from denarii_ledger_entries where user_id=$1 and source_reference='puzzle:medium:0'",[uid]))[0].n,1);
 console.log('Puzzle owned relics passed: Sword, Donkey warning, Crystal Ball reveal, timer on found target, no extra FIGS or repeated reward.');
 // Forfeiting is authenticated, atomic and idempotent, including on another player's turn.
 await query("select set_config('app.uid',$1,false)",[uid]);
 const forfeit=async(id)=>query('select public.forfeit_prelude_game($1)',[id]);
 let quit=await prelude('create',{machine:true});quit=await prelude('start',{id:quit.id});
 await query("select set_config('app.uid',$1,false)",[other]);
 await assert.rejects(forfeit(quit.id),/own place/);
 await query("select set_config('app.uid',$1,false)",[uid]);
 await forfeit(quit.id);await forfeit(quit.id);
 quit=await prelude('state',{id:quit.id});
 assert.equal(quit.phase,'completed');assert.equal(quit.winnerId,'machine');assert.equal(quit.reward,0);
 assert.equal((await query('select forfeit_reason from arena_participants where room_id=$1 and user_id=$2',[quit.id,uid]))[0].forfeit_reason,'manual');
 assert.equal((await query("select count(*)::int n from denarii_ledger_entries where source_reference=$1",['prelude:'+quit.id]))[0].n,0);
 // Remove the current player from a pending question without skipping the next player.
 let trio=await prelude('create');
 const third='00000000-0000-4000-8000-000000000003';
 for(const id of [other,third]){await query("select set_config('app.uid',$1,false)",[id]);await prelude('join',{id:trio.id});}
 await query("select set_config('app.uid',$1,false)",[uid]);trio=await prelude('start',{id:trio.id});
 let ts=(await query('select state from scripture_games.prelude_games where room_id=$1',[trio.id]))[0].state;
 let matching=ts.deck.find(c=>!c.drawn&&!c.joker&&(c.number===trio.board[0].number||c.symbol===trio.board[0].symbol));
 trio=await prelude('flip',{id:trio.id,slot:matching.slot,version:trio.version});assert.equal(trio.phase,'question');
 await forfeit(trio.id);trio=await prelude('state',{id:trio.id});
 assert.equal(trio.phase,'playing');assert.equal(trio.pending,null);assert.equal(trio.players[trio.turn].id,other);
 assert.equal(trio.players.length,2);
 await assert.rejects(prelude('join',{id:trio.id}),/accepting/);
 await assert.rejects(prelude('flip',{id:trio.id,slot:trio.cards[0].slot,version:trio.version}),/Join/);
 await query("select set_config('app.uid',$1,false)",[third]);await forfeit(trio.id);
 trio=await prelude('state',{id:trio.id});assert.equal(trio.phase,'completed');assert.equal(trio.winnerId,other);
 assert.equal((await query('select winner_id,completion_reason from arena_rooms where id=$1',[trio.id]))[0].completion_reason,'forfeit');
 await query("select set_config('app.uid',$1,false)",['']);await assert.rejects(forfeit(trio.id),/Sign in/);
 console.log('Prelude forfeit passed: actor checks, Scribe and multiplayer settlement, turn removal, no rejoin, no reward farming, repeated calls.');
 await db.exec('SET ROLE anon');
 await assert.rejects(query("select public.prelude_command('list')"),/permission denied/);
 await assert.rejects(query('select * from scripture_games.puzzle_catalog'),/permission denied/);
 await db.exec('RESET ROLE');
 console.log('Scripture games passed: hidden answers/references/deck, word FIGS, 500 once, relic consumption, ownership, 104 cards/four jokers, matching/capture/target changes, stale turns, actor checks, 1000 once.');
}catch(error){console.error(error.message,error.where||'');process.exitCode=1;}finally{await db.close();}
