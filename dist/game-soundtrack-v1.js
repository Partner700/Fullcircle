// Use the already-loaded Arena soundscape from the verified Release 295 app.
// No new audio downloads, auth access, or private application code are included.
export const ARENA_TRACK = 'sound_game_level_1';
export function soundtrackForView(view) {
  if (view.puzzle) return {key: view.puzzlePlaying?'puzzle-playing':'puzzle-lobby', track:view.puzzlePlaying?ARENA_TRACK:'sound_arena_lobby'};
  if (view.prelude) return {key:view.preludePlaying?'prelude-playing':'prelude-lobby',track:view.preludePlaying?ARENA_TRACK:'sound_arena_lobby'};
  if (view.title==='Daily Trivia') {
    if(view.dailyLevel)return {key:`daily-${view.dailyLevel}`,track:ARENA_TRACK};
    if(view.dailyRoundTransition)return {key:'daily-round-transition',track:ARENA_TRACK};
    if(view.dailyLobby)return {key:'daily-lobby',track:'sound_arena_lobby'};
  }
  return null;
}
function readView() {
  const root=document.getElementById('root');
  const main=root?.querySelector('main');
  if(!main)return {title:''};
  const title=root.querySelector('.app-safe-header h2')?.textContent?.trim()||'';
  const puzzle=main.querySelector('section[aria-label="Puzzle Trivia"]');
  const prelude=main.querySelector('section[aria-label="The Prelude"]');
  const buttons=[...main.querySelectorAll('button')].map(button=>button.textContent.trim());
  const headings=[...main.querySelectorAll('h2,h3')].map(heading=>heading.textContent.trim());
  const puzzlePlaying=Boolean(puzzle?.querySelector('[data-letter-index]'))&&!headings.includes('Time is up')&&!headings.includes('Puzzle complete!');
  const preludePlaying=Boolean(prelude&&[...prelude.querySelectorAll('p')].some(p=>/\d+\s+unused cards/.test(p.textContent||'')));
  const badge=[...main.querySelectorAll('.badge')].map(el=>el.textContent.trim()).find(value=>/^(Normal|Practice)\s*·\s*L(?:evel\s*)?[1-7]$/.test(value));
  const preparing=[...main.querySelectorAll('p')].map(el=>el.textContent.trim()).find(value=>/^Preparing level [1-7]…$/.test(value));
  const level=(badge||preparing||'').match(/[1-7]$/)?.[0]||(preparing?.match(/[1-7]/)?.[0]||null);
  return {title,puzzle:Boolean(puzzle),puzzlePlaying,prelude:Boolean(prelude),preludePlaying,dailyLevel:level,
    dailyRoundTransition:headings.includes('Time has elapsed')&&buttons.some(label=>/^Start Round \d+$|^Finish Level$/.test(label)),
    dailyLobby:buttons.includes('Back to Daily Games')||headings.includes('Level Cleared!')||headings.includes('Level Failed')||headings.includes('Level unavailable')};
}
async function install() {
  const entry=document.querySelector('script[type="module"][src*="/assets/index-"],script[type="module"][src^="./assets/index-"]');
  // Disable this compatibility layer when the core is upgraded.
  if(!entry||!entry.src.endsWith('/assets/index-Br8Lu9Aj.js'))return;
  let service=null, loading=null, lastKey='', lastEnabled=false, lastAttempt=0, timer=0;
  async function getService(){
    if(service)return service;
    if(!loading)loading=import(new URL('ContextRelicShop-BNZ7T02F.js',entry.src).href).then(module=>{
      if(typeof module.s!=='function'||typeof module.B!=='function'||typeof module.a0!=='function')return null;
      return service={play:module.s,enabled:module.B,playing:module.a0};
    }).catch(()=>null);
    return loading;
  }
  async function synchronize(force=false){
    const view=readView();const target=soundtrackForView(view);
    if(!target){
      // On return from an individual Arena game, its parent lobby does not
      // remount. Restore the existing Arena lobby sound once, not on other tabs.
      const restore=view.title==='Arena'&&/^(puzzle|prelude)-/.test(lastKey);
      lastKey='';lastEnabled=false;
      if(restore&&service?.enabled())await service.play('sound_arena_lobby');
      return;
    }
    const audio=await getService();if(!audio||soundtrackForView(readView())?.key!==target.key)return;
    const enabled=audio.enabled();
    if(!enabled){lastEnabled=false;lastKey=target.key;return;}
    const changed=lastKey!==target.key||!lastEnabled;
    lastKey=target.key;lastEnabled=true;
    if(!force&&!changed&&(audio.playing()||Date.now()-lastAttempt<5000))return;
    lastAttempt=Date.now();await audio.play(target.track);
  }
  function schedule(force=false){clearTimeout(timer);timer=setTimeout(()=>{void synchronize(force).catch(()=>undefined);},180);}
  // Only act when the native engine's sound setting is enabled. The native
  // sound toggle remains responsible for muting every track and effect.
  window.addEventListener('full-circle-sound-state',event=>{
    if(!event.detail?.enabled){lastEnabled=false;return;}
    if(!lastEnabled)schedule(true);
  });
  window.addEventListener('click',()=>{if(service&&!service.playing()&&service.enabled())schedule();},{passive:true});
  setInterval(()=>{if(document.visibilityState==='visible')void synchronize().catch(()=>undefined);},700);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')schedule();});
  void synchronize().catch(()=>undefined);
}
if(typeof document!=='undefined')void install().catch(()=>undefined);
