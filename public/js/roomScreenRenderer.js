/* The scene owns the fixed screen canvas and all GPU resources. */
(() => {
  function create(screen){
    if(!RoomScreen.metadata(screen))throw new Error('INVALID_SCREEN');
    const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=Math.round(1280*screen.height/screen.width);
    // Keep extreme custom aspect ratios bounded too.
    if(canvas.height>2048){canvas.height=2048;canvas.width=Math.round(2048*screen.width/screen.height);}
    const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;
    function pattern(){
    ctx.fillStyle='#14253d';ctx.fillRect(0,0,w,h);ctx.strokeStyle='#41607f';ctx.lineWidth=2;
    for(let n=0;n<=8;n++){ctx.beginPath();ctx.moveTo(w*n/8,0);ctx.lineTo(w*n/8,h);ctx.stroke();ctx.beginPath();ctx.moveTo(0,h*n/8);ctx.lineTo(w,h*n/8);ctx.stroke();}
    ctx.fillStyle='#f2f7ff';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=`bold ${Math.max(12,Math.min(w/10,h/5))}px sans-serif`;
    ctx.fillText('3DTalks',w/2,h*.42);ctx.font=`${Math.max(10,Math.min(w/24,h/12))}px sans-serif`;
    ctx.fillText(window.i18n?.t('roomScreen.test')||'Test screen · FRONT',w/2,h*.65);
    }
    pattern();
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    const group=new THREE.Group();group.userData.screenCanvas=canvas;
    const updated=()=>{texture.needsUpdate=true;window.RoomScreenPreview?.refresh(canvas);};
    group.userData.presentation={canvas,
      reset(){pattern();updated();},
      message(text){ctx.fillStyle='#14253d';ctx.fillRect(0,0,w,h);ctx.fillStyle='#f2f7ff';ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.font=`${Math.max(10,Math.min(w/28,h/10))}px sans-serif`;ctx.fillText(text,w/2,h/2,w*.9);updated();},
      draw(source){ctx.fillStyle='#101010';ctx.fillRect(0,0,w,h);const scale=Math.min(w/source.width,h/source.height);
        ctx.drawImage(source,(w-source.width*scale)/2,(h-source.height*scale)/2,source.width*scale,source.height*scale);updated();}
    };
    const front=new THREE.Mesh(new THREE.PlaneGeometry(screen.width,screen.height),new THREE.MeshBasicMaterial({map:texture,toneMapped:false}));
    front.position.z=.025;group.add(front);
    const back=new THREE.Mesh(new THREE.BoxGeometry(screen.width+.08,screen.height+.08,.04),new THREE.MeshBasicMaterial({color:0x111820}));
    group.add(back);return group;
  }
  window.RoomScreenRenderer={create};
})();
