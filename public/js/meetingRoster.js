/** Server-derived meeting roster. Independent of avatars, DOM and transport. */
(() => {
  if(!window.MeetingUI?.active)return;
  const live=new Map();
  const members=new Map(), recordings=new Map(), playback=new Map(), listeners=new Set();
  let roomId=null, connection='connecting', stopped=false;
  const valid=p=>p&&typeof p.characterId==='string'&&p.characterId.length>0&&p.characterId.length<=128&&
    typeof p.characterName==='string'&&p.characterName.length<=256;
  function snapshot(){
    const self=window.GAME_STATE?.characterId;
    return Object.freeze({roomId,connection,members:Object.freeze([...members.values()].map(p=>Object.freeze({
      id:p.characterId,name:p.characterName,self:p.characterId===self,
      audio:live.get(p.characterId)||null,recording:recordings.has(p.characterId),playing:!!playback.get(p.characterId)?.size
    })).sort((a,b)=>Number(b.self)-Number(a.self)||a.name.localeCompare(b.name)||a.id.localeCompare(b.id)))});
  }
  function emit(){const value=snapshot();for(const fn of listeners)fn(value);}
  function clearActivity(id){
    if(id===undefined)live.clear();else live.delete(id);
    if(id!==undefined){clearTimeout(recordings.get(id));recordings.delete(id);playback.delete(id);return;}
    for(const timer of recordings.values())clearTimeout(timer);
    recordings.clear();playback.clear();
  }
  window.MeetingRoster={
    start(id){clearActivity();members.clear();roomId=id;connection='connecting';stopped=false;emit();},
    getState:snapshot,
    subscribe(fn){listeners.add(fn);fn(snapshot());return ()=>listeners.delete(fn);},
    snapshot(players){
      if(stopped||!Array.isArray(players)||players.length>64)return;
      const fresh=new Map();for(const p of players)if(valid(p)&&fresh.size<6)fresh.set(p.characterId,{characterId:p.characterId,characterName:p.characterName});
      for(const id of members.keys())if(!fresh.has(id))clearActivity(id);
      members.clear();for(const [id,p] of fresh)members.set(id,p);
      connection='connected';emit();
    },
    joined(p){if(stopped||!valid(p)||!members.has(p.characterId)&&members.size>=6)return;members.set(p.characterId,{characterId:p.characterId,characterName:p.characterName});emit();},
    left(id){if(stopped)return;clearActivity(id);members.delete(id);emit();},
    connection(value){if(stopped||!['connecting','reconnecting'].includes(value))return;connection=value==='connecting'&&members.size?'reconnecting':value;clearActivity();emit();},
    liveAudio(id, value){
      if(stopped||connection!=='connected'||!members.has(id))return;
      const previous=live.get(id);
      if(previous?.microphone===value.microphone&&previous?.speaking===value.speaking)return;
      live.set(id,{microphone:!!value.microphone,speaking:!!value.speaking});emit();
    },
    clearLiveAudio(){if(live.size){live.clear();emit();}},
    recording(id,on){
      if(stopped||connection!=='connected'||!members.has(id)||typeof on!=='boolean')return;
      clearTimeout(recordings.get(id));recordings.delete(id);
      if(on)recordings.set(id,setTimeout(()=>{recordings.delete(id);emit();},70000));
      emit();
    },
    playback(id,key,on){
      if(stopped||connection!=='connected'||!members.has(id))return;
      let sources=playback.get(id);
      if(on){if(!sources)playback.set(id,sources=new Set());sources.add(key);}
      else{sources?.delete(key);if(!sources?.size)playback.delete(id);}
      emit();
    },
    stop(){if(stopped)return;stopped=true;clearActivity();members.clear();roomId=null;connection='stopped';emit();listeners.clear();}
  };
})();
