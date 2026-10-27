/* Local copy of the shared screen. Never sends presentation commands. */
(() => {
  let active;
  const t=key=>window.i18n?.t('roomScreen.'+key)||key;
  function close(){active?.dialog.close();}
  function refreshVideoControls(){if(!active)return;active.restoreVideo?.();active.restoreVideo=window.RoomPresentation?.borrowVideoControls?.(active.source,active.dialog);}
  function refresh(source){
    if(active?.source!==source)return;
    if(!source.width||!source.height){close();return;}
    const {canvas}=active;
    if(canvas.width!==source.width||canvas.height!==source.height){canvas.width=source.width;canvas.height=source.height;active.scale();}
    const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(source,0,0);
  }
  function open(source,name,trigger=document.activeElement){
    close();if(!source?.width||!source?.height)return;
    const dialog=document.createElement('dialog');dialog.className='meeting-ui room-screen-preview';
    const header=document.createElement('div');header.className='screen-preview-header';
    const title=document.createElement('h2');
    title.id='room-screen-title';title.textContent=name||t('enlarge');title.title=title.textContent;
    dialog.setAttribute('aria-labelledby',title.id);
    const button=document.createElement('button');button.type='button';button.className='ui-button ui-button--ghost screen-preview-close';button.autofocus=true;button.setAttribute('aria-label',t('close'));button.onclick=()=>dialog.close();
    const icon=document.createElement('img');icon.src='/icons/lucide/x.svg';icon.alt='';icon.width=icon.height=20;button.append(icon);header.append(title,button);
    const canvas=document.createElement('canvas');canvas.width=source.width;canvas.height=source.height;canvas.getContext('2d').drawImage(source,0,0);
    canvas.setAttribute('role','img');canvas.setAttribute('aria-label',t('content')+' — '+name);
    const frame=document.createElement('div');frame.className='screen-preview-frame';frame.tabIndex=0;frame.setAttribute('role','region');frame.setAttribute('aria-label',t('pan'));frame.append(canvas);
    const toolbar=document.createElement('div');toolbar.className='screen-preview-toolbar';
    const minus=document.createElement('button'),plus=document.createElement('button'),fit=document.createElement('button'),value=document.createElement('output');
    minus.type=plus.type=fit.type='button';minus.className=plus.className='ui-button screen-preview-zoom';fit.className='ui-button ui-button--ghost';
    minus.textContent='−';plus.textContent='+';fit.textContent=t('fit');minus.setAttribute('aria-label',t('zoomOut'));plus.setAttribute('aria-label',t('zoomIn'));value.setAttribute('aria-label',t('zoom'));value.className='screen-preview-scale';
    let zoom=1;
    const scale=()=>{
      const css=getComputedStyle(frame),bounds=frame.getBoundingClientRect();
      // Reserve room for platform scrollbars so the fit position stays inside the frame.
      const width=Math.max(1,bounds.width-parseFloat(css.paddingLeft)-parseFloat(css.paddingRight)-20);
      const height=Math.max(1,bounds.height-parseFloat(css.paddingTop)-parseFloat(css.paddingBottom)-20);
      const base=Math.min(source.width,width,height*source.width/source.height);
      canvas.style.width=Math.max(1,base*zoom)+'px';value.textContent=Math.round(zoom*100)+'%';minus.disabled=zoom<=.5;plus.disabled=zoom>=3;fit.disabled=zoom===1;
    };
    minus.onclick=()=>{zoom=Math.max(.5,zoom-.25);scale();};plus.onclick=()=>{zoom=Math.min(3,zoom+.25);scale();};fit.onclick=()=>{zoom=1;scale();frame.scrollTo(0,0);};
    const hint=document.createElement('p');hint.className='screen-preview-hint';hint.textContent=t('localHint');
    toolbar.append(minus,value,plus,fit);header.append(toolbar);dialog.append(header,frame,hint);
    const session=active={dialog,canvas,source,scale};
    dialog.addEventListener('keydown',e=>{if(e.key==='Tab'){
      const nodes=[...dialog.querySelectorAll('button,input,[tabindex="0"]')].filter(n=>!n.disabled&&n.getClientRects().length),index=nodes.indexOf(document.activeElement);
      if(e.shiftKey&&(index===0||index<0)){e.preventDefault();nodes.at(-1)?.focus();}
      else if(!e.shiftKey&&(index===nodes.length-1||index<0)){e.preventDefault();nodes[0]?.focus();}
    }});
    for(const event of ['pointerdown','pointerup','click','keydown','keyup','wheel','touchstart','touchmove'])dialog.addEventListener(event,e=>e.stopPropagation());
    const observer=new ResizeObserver(()=>{if(active===session&&dialog.open)scale();});
    dialog.addEventListener('close',()=>{session.restoreVideo?.();observer.disconnect();dialog.remove();canvas.width=canvas.height=0;if(active===session)active=null;if(trigger?.isConnected)trigger.focus();},{once:true});
    document.body.append(dialog);refreshVideoControls();dialog.showModal();scale();observer.observe(frame);
  }
  function mount(source,name,target){
    if(!target)return ()=>{};
    const button=document.createElement('button');button.type='button';button.id='meeting-screen-preview';if(window.MeetingUI?.active)button.className='ui-button';button.dataset.i18n='roomScreen.enlarge';button.textContent=t('enlarge');
    button.addEventListener('pointerdown',e=>e.stopPropagation());
    button.addEventListener('click',e=>{e.stopPropagation();open(source,name,button);});target.append(button);
    return ()=>{close();button.remove();};
  }
  window.RoomScreenPreview={open,close,mount,refresh,refreshVideoControls};
})();
