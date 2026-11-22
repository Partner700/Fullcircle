// Isolated Arena UI for the verified Release 295 browser runtime. No credentials,
// database policies, game logic, external services or payment code are included.
const HEART = '❤️';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const cleanRoomName = value => String(value || '').replace(/\s*\[.*?\]/g, '').trim();
export function selectRoom(rooms, view) {
  const eligible = rooms.filter(room => room && room.status === 'playing' && (!view.name || cleanRoomName(room.room_name) === view.name));
  const unique = [...new Map(eligible.map(room => [room.id, room])).values()];
  return unique.length === 1 ? unique[0] : null;
}
export function classifyMessages(previous, messages, userId, now = Date.now()) {
  const seen = new Set(previous || []);
  const fresh = messages.filter(message => !seen.has(message.id));
  messages.forEach(message => seen.add(message.id));
  return {seen, unread: previous ? fresh.filter(message => message.body.trim() !== HEART && (!userId || message.sender_id !== userId)).length : 0,
    hearts: previous ? fresh.filter(message => message.body.trim() === HEART && now - Date.parse(message.created_at) < 15000).length : 0};
}
function viewState() {
  const root = document.getElementById('root');
  if (!root) return null;
  const main = root.querySelector('main');
  if (!main) return null;
  const buttons = [...main.querySelectorAll('button')];
  const has = label => buttons.some(button => button.textContent.trim() === label);
  const witnessing = [...main.querySelectorAll('.badge')].some(el => el.textContent.trim() === 'Witnessing Live');
  const classic = [...main.querySelectorAll('.badge')].some(el => el.textContent.trim() === 'Arena Battle');
  const prelude = main.querySelector('section[aria-label="The Prelude"]');
  if (prelude && has('Forfeit round')) return {kind:'prelude', name:'', spectator:false};
  if (prelude && prelude.querySelector('input[name="prelude-answer"]')) return {kind:'prelude', name:'', spectator:false};
  const road = [...main.querySelectorAll('p.eyebrow')].find(el => el.textContent.trim() === 'Full Circle: The Road Home');
  if (road) return {kind:'ludo', name:cleanRoomName(road.parentElement.querySelector('h2')?.textContent), spectator:witnessing};
  if (has('Back to Arena') && has('Chat')) {
    const back = buttons.find(button => button.textContent.trim() === 'Back to Arena');
    const heading = back?.parentElement?.parentElement?.querySelector('h2');
    if (heading) return {kind:'journey', name:cleanRoomName(heading.textContent), spectator:null};
  }
  if (classic || witnessing) {
    const witnessLabel = [...main.querySelectorAll('.badge')].find(el => el.textContent.trim() === 'Witnessing Live');
    const name = witnessLabel?.parentElement?.nextElementSibling?.nextElementSibling?.querySelector('span.font-semibold');
    return {kind:'classic', name:witnessing ? cleanRoomName(name?.textContent) : '', spectator:witnessing};
  }
  return null;
}
const storageGet = key => { try { return localStorage.getItem(key); } catch { return null; } };
function element(tag, className, text) { const node = document.createElement(tag); node.className = className; if (text) node.textContent = text; return node; }
function button(label, style) { const el = element('button', style, label); el.type = 'button'; return el; }
const valid = id => typeof id === 'string' && UUID.test(id);

async function boot() {
  // Import the same already-loaded, verified module instance. These bindings are
  // the existing authenticated client and existing room chat service methods.
  const entry = document.querySelector('script[type="module"][src*="/assets/index-"],script[type="module"][src^="./assets/index-"]');
  if (!entry || !entry.src.endsWith('/assets/index-Br8Lu9Aj.js')) return;
  const api = await import(entry.src);
  const {s:client,dQ:loadMessages,dT:sendMessage,cB:getRoom,dS:sendGuest,cC:getSuccessor} = api;
  if (!client?.auth || ![loadMessages,sendMessage,getRoom,sendGuest,getSuccessor].every(fn=>typeof fn==='function')) return;
  const bar = element('div','fc-arena-engagement-bar'); bar.hidden=true;
  const love = button('♥','fc-arena-heart-button'); love.setAttribute('aria-label','Send love to the match');
  const chat = button('Chat','fc-arena-chat-button'); chat.setAttribute('aria-label','Open live match chat');
  const badge = element('span','fc-arena-unread'); badge.hidden=true; chat.append(badge);
  const sky = element('div','fc-arena-heart-sky'); sky.setAttribute('aria-hidden','true');
  const status = element('span','fc-arena-status'); status.setAttribute('role','status'); bar.append(love,chat,status);
  const panel = element('section','fc-arena-chat-panel'); panel.hidden=true; panel.setAttribute('role','dialog'); panel.setAttribute('aria-label','Live match chat');
  const title = element('h3','fc-arena-chat-title','Live match chat'); const close = button('×','fc-arena-chat-close'); close.setAttribute('aria-label','Close live match chat');
  const header = element('div','fc-arena-chat-header'); header.append(title,close);
  const list = element('div','fc-arena-chat-list'); list.setAttribute('role','log'); list.setAttribute('aria-label','Match messages');
  const form = element('form','fc-arena-chat-form'); const input = element('input','fc-arena-chat-input'); input.type='text'; input.maxLength=500; input.placeholder='Encourage the players…'; input.setAttribute('aria-label','Message');
  const send = element('button','fc-arena-send','Send'); send.type='submit'; form.append(input,send); const panelStatus=element('p','fc-arena-panel-status'); panelStatus.setAttribute('role','status');
  panel.append(header,list,form,panelStatus); document.body.append(bar,sky,panel);
  let context=null, seen=null, unread=0, busy=false, polling=false, resolving=false, latest=[], lastHeart=0, viewKey='', lastCheck=0, generation=0;
  let authId=null, authChecked=false;
  function setCount(){badge.hidden=unread===0;badge.textContent=unread>99?'99+':String(unread);chat.setAttribute('aria-label',unread?`Open live match chat, ${unread} unread messages`:'Open live match chat');}
  function reset(){generation++;context=null;seen=null;latest=[];unread=0;setCount();bar.hidden=true;panel.hidden=true;list.replaceChildren();sky.replaceChildren();status.textContent='';panelStatus.textContent='';input.value='';}
  client.auth.onAuthStateChange((_event,session)=>{const id=session?.user?.id||null;if(authChecked&&id!==authId){reset();viewKey='';}authId=id;authChecked=true;});
  async function resolve(view) {
    const route = new URL(location.href);
    if (!authChecked) { const {data}=await client.auth.getUser(); authId=data?.user?.id||null; authChecked=true; }
    if (!authId) {
      if(route.searchParams.get('share')!=='arena')return null;
      const originId=route.searchParams.get('id'); if(!valid(originId))return null;
      const guestKey=storageGet(`full-circle-arena-guest:${originId}`); if(!guestKey)return null;
      let room=await getRoom(originId);
      if(!room){const successor=await getSuccessor(originId);if(valid(successor))room=await getRoom(successor);}
      const selected=selectRoom([room],view);return selected?{room:selected,userId:'',guestKey}:null;
    }
    const userId=authId;
    const candidateIds=[];
    if(view.spectator!==true){const id=storageGet(view.kind==='prelude'?`full-circle:prelude:${userId}`:`full-circle-active-arena-room-${userId}`);if(valid(id))candidateIds.push({id,role:'player'});}
    if(view.spectator!==false){const {data,error}=await client.from('arena_viewers').select('room_id,last_seen_at').eq('user_id',userId).gte('last_seen_at',new Date(Date.now()-120000).toISOString());if(!error&&data?.length===1&&valid(data[0].room_id))candidateIds.push({id:data[0].room_id,role:'viewer'});}
    // Resolve only a uniquely identified live room. Never guess from unrelated rooms.
    const rooms=[];
    for(const candidate of candidateIds){const room=await getRoom(candidate.id);if(!room)continue;if(candidate.role==='player'&&!room.participants?.some(player=>player.user_id===userId))continue;rooms.push(room);}
    const room=selectRoom(rooms,view);return room?{room,userId,guestKey:null}:null;
  }
  async function inspect() {
    const view=viewState(); const key=view?JSON.stringify(view):'';
    if(!view){if(context||viewKey)reset();viewKey='';return;}
    if(key!==viewKey){reset();viewKey=key;lastCheck=0;}
    if(resolving||Date.now()-lastCheck<5000)return;
    resolving=true;lastCheck=Date.now(); const ticket=generation;
    try {const next=await resolve(view);if(ticket!==generation||JSON.stringify(viewState())!==key)return;
      if(!next){if(context)reset();return;}
      if(context?.room.id!==next.room.id||context?.userId!==next.userId){reset();context=next;title.textContent=`Live chat · ${cleanRoomName(next.room.room_name)}`;void poll();}
      else context=next;
      bar.hidden=false;
    } catch { /* Fail closed: no send control when the room can't be verified. */ if(ticket===generation&&context)reset(); }
    finally{resolving=false;}
  }
  function animate(count){for(let burst=0;burst<Math.min(3,count);burst++){for(let i=0;i<5;i++){const heart=element('span',`fc-arena-flying-heart fc-arena-h${i}`,HEART);sky.append(heart);setTimeout(()=>heart.remove(),2100);}}}
  function render(){list.replaceChildren();for(const message of latest.filter(m=>m.body.trim()!==HEART)){const row=element('div','fc-arena-chat-message');const who=element('strong','',message.sender_id&&message.sender_id===context?.userId?'You':message.sender?.display_name||'Witness');const body=element('span','',message.body);row.append(who,body);list.append(row);}list.scrollTop=list.scrollHeight;}
  async function poll(){if(!context||polling||document.visibilityState!=='visible')return;polling=true;const current=context,ticket=generation;try{const messages=await loadMessages(current.room.id);if(ticket!==generation)return;const next=classifyMessages(seen,messages,current.userId);seen=next.seen;latest=messages;if(next.hearts)animate(next.hearts);const nativeOpen=Boolean(document.querySelector('[role="dialog"][aria-label="Arena match chat"]'));if(panel.hidden&&!nativeOpen)unread+=next.unread;else unread=0;setCount();if(!panel.hidden)render();}catch{/* retry on next poll */}finally{polling=false;}}
  async function post(body){const view=viewState();if(!context||busy||!view||!body.trim()||body.length>500)return false;const current=context,ticket=generation,key=JSON.stringify(view);busy=true;love.disabled=true;send.disabled=true;status.textContent='';panelStatus.textContent='';try{const checked=await resolve(view);if(ticket!==generation||JSON.stringify(viewState())!==key||!checked||checked.room.id!==current.room.id||checked.userId!==current.userId)return false;if(current.guestKey)await sendGuest(current.room.id,current.guestKey,body);else await sendMessage(current.room.id,current.userId,body);if(ticket===generation)void poll();return true;}catch{status.textContent='Could not send. Try again.';panelStatus.textContent='Could not send. Try again.';return false;}finally{busy=false;love.disabled=false;send.disabled=false;}}
  love.addEventListener('click',()=>{if(Date.now()-lastHeart<1000)return;lastHeart=Date.now();void post(HEART);});
  chat.addEventListener('click',()=>{panel.hidden=false;unread=0;setCount();render();input.focus();});
  close.addEventListener('click',()=>{panel.hidden=true;chat.focus();});
  panel.addEventListener('keydown',event=>{if(event.key==='Escape'){panel.hidden=true;chat.focus();}});
  form.addEventListener('submit',async event=>{event.preventDefault();const value=input.value.trim();if(await post(value))input.value='';});
  setInterval(()=>{if(document.visibilityState==='visible'){void inspect();void poll();}},2000);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){lastCheck=0;void inspect();void poll();}});
  void inspect();
}
if(typeof document!=='undefined')void boot().catch(()=>undefined);
