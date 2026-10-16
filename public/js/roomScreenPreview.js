/* Native modal supplies Escape handling, focus trapping and return of focus. */
(() => {
  let active;
  const t=key=>window.i18n?.t('roomScreen.'+key)||key;
  function close(){active?.dialog.close();}
  function refresh(source){if(active?.source===source){active.canvas.getContext('2d').clearRect(0,0,active.canvas.width,active.canvas.height);active.canvas.getContext('2d').drawImage(source,0,0);}}
  function open(source,name,trigger=document.activeElement){
    close();
    const dialog=document.createElement('dialog');
    dialog.style.cssText='box-sizing:border-box;max-width:95vw;max-height:92dvh;background:#14253d;color:white;border:1px solid #64748b;border-radius:12px;padding:16px;overflow:auto';
    const title=document.createElement('h2');title.id='room-screen-title';title.textContent=name;
    dialog.setAttribute('aria-labelledby',title.id);
    const button=document.createElement('button');button.type='button';button.textContent=t('close');button.autofocus=true;button.onclick=()=>dialog.close();
    const canvas=document.createElement('canvas');canvas.width=source.width;canvas.height=source.height;canvas.getContext('2d').drawImage(source,0,0);
    const session=active={dialog,canvas,source};
    const frame=document.createElement('div');frame.style.cssText='max-width:85vw;max-height:65dvh;overflow:auto;margin-top:12px';
    canvas.style.cssText='display:block;height:auto';frame.append(canvas);
    let zoom=1;const width=Math.min(source.width,innerWidth*.82,innerHeight*.6*source.width/source.height);
    const minus=document.createElement('button'),plus=document.createElement('button'),value=document.createElement('span');
    minus.type=plus.type='button';minus.textContent='−';plus.textContent='+';minus.setAttribute('aria-label',t('zoomOut'));plus.setAttribute('aria-label',t('zoomIn'));
    const scale=()=>{canvas.style.width=width*zoom+'px';value.textContent=' '+Math.round(zoom*100)+'% ';minus.disabled=zoom<=.5;plus.disabled=zoom>=3;};
    minus.onclick=()=>{zoom=Math.max(.5,zoom-.25);scale();};plus.onclick=()=>{zoom=Math.min(3,zoom+.25);scale();};scale();
    canvas.setAttribute('role','img');canvas.setAttribute('aria-label',t('test'));
    dialog.append(title,button,minus,value,plus,frame);
    dialog.addEventListener('keydown',e=>{if(e.key==='Tab'){
      const nodes=[button,minus,plus].filter(n=>!n.disabled),index=nodes.indexOf(document.activeElement);e.preventDefault();nodes[(index+(e.shiftKey?-1:1)+nodes.length)%nodes.length].focus();
    }});
    for(const event of ['pointerdown','pointerup','click','keydown','keyup','wheel','touchstart','touchmove'])dialog.addEventListener(event,e=>e.stopPropagation());
    dialog.addEventListener('close',()=>{dialog.remove();canvas.width=canvas.height=0;if(active===session)active=null;if(trigger?.isConnected)trigger.focus();},{once:true});
    document.body.append(dialog);dialog.showModal();
  }
  function mount(source,name,target){
    if(!target)return ()=>{};
    const button=document.createElement('button');button.type='button';button.id='meeting-screen-preview';button.dataset.i18n='roomScreen.enlarge';button.textContent=t('enlarge');
    button.addEventListener('pointerdown',e=>e.stopPropagation());
    button.addEventListener('click',e=>{e.stopPropagation();open(source,name,button);});target.append(button);
    return ()=>{close();button.remove();};
  }
  window.RoomScreenPreview={open,close,mount,refresh};
})();
