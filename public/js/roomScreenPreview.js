/* Native modal supplies Escape handling, focus trapping and return of focus. */
(() => {
  let active;
  const t=key=>window.i18n?.t('roomScreen.'+key)||key;
  function close(){active?.close();}
  function open(source,name,trigger=document.activeElement){
    close();
    const dialog=document.createElement('dialog');active=dialog;
    dialog.style.cssText='max-width:95vw;max-height:92dvh;background:#14253d;color:white;border:1px solid #64748b;border-radius:12px;padding:16px;overflow:auto';
    const title=document.createElement('h2');title.id='room-screen-title';title.textContent=name;
    dialog.setAttribute('aria-labelledby',title.id);
    const button=document.createElement('button');button.type='button';button.textContent=t('close');button.autofocus=true;button.onclick=()=>dialog.close();
    const canvas=document.createElement('canvas');canvas.width=source.width;canvas.height=source.height;canvas.getContext('2d').drawImage(source,0,0);
    canvas.style.cssText='display:block;max-width:85vw;max-height:70dvh;width:auto;height:auto;margin-top:12px';
    canvas.setAttribute('role','img');canvas.setAttribute('aria-label',t('test'));
    dialog.append(title,button,canvas);
    dialog.addEventListener('keydown',e=>{if(e.key==='Tab'){e.preventDefault();button.focus();}});
    for(const event of ['pointerdown','pointerup','click','keydown','keyup','wheel','touchstart','touchmove'])dialog.addEventListener(event,e=>e.stopPropagation());
    dialog.addEventListener('close',()=>{dialog.remove();canvas.width=canvas.height=0;if(active===dialog)active=null;if(trigger?.isConnected)trigger.focus();},{once:true});
    document.body.append(dialog);dialog.showModal();
  }
  function mount(source,name,target){
    if(!target)return ()=>{};
    const button=document.createElement('button');button.type='button';button.id='meeting-screen-preview';button.dataset.i18n='roomScreen.enlarge';button.textContent=t('enlarge');
    button.addEventListener('pointerdown',e=>e.stopPropagation());
    button.addEventListener('click',e=>{e.stopPropagation();open(source,name,button);});target.append(button);
    return ()=>{close();button.remove();};
  }
  window.RoomScreenPreview={open,close,mount};
})();
