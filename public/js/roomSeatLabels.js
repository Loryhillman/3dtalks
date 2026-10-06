// Screen-space labels shared by the editor and the participant's seat picker.
(() => {
  class RoomSeatLabels {
    constructor(onSelect, zIndex = 11000) {
      this.root = document.createElement('div');
      this.root.className = 'room-seat-labels';
      this.root.style.cssText = `position:fixed;inset:0;pointer-events:none;z-index:${zIndex};overflow:hidden`;
      this.nodes = new Map(); this.onSelect = onSelect; document.body.append(this.root);
    }
    update(camera, canvas, entries, visible = true, interactive = true) {
      this.root.hidden = !visible;
      if (!visible || !camera || !canvas) return;
      camera.updateMatrixWorld();
      const rect = canvas.getBoundingClientRect(), keep = new Set();
      for (const entry of entries) {
        if (!entry.position) continue;
        const key = String(entry.id); keep.add(key);
        let node = this.nodes.get(key);
        if (!node) {
          node = document.createElement('button');node.type='button';node.dataset.seatId=key;
          node.style.cssText='position:absolute;transform:translate(-50%,-100%);max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:5px 9px;border:2px solid white;border-radius:16px;color:white;font:600 13px system-ui;box-shadow:0 2px 6px #0008;cursor:pointer';
          node.onclick = event => {event.stopPropagation();this.onSelect?.(entry.id);};
          this.root.append(node);this.nodes.set(key,node);
        }
        if(node.textContent!==entry.label)node.textContent=entry.label;node.title=entry.title || entry.label;
        node.setAttribute('aria-label',entry.title || entry.label);
        node.style.pointerEvents=interactive?'auto':'none';node.tabIndex=interactive?0:-1;
        node.style.background=entry.selected?'#a05b06':entry.color || '#28516f';
        node.style.outline=entry.selected?'3px solid #ffdc81':'none';
        const p=new THREE.Vector3(entry.position.x,entry.position.y+.65,entry.position.z).project(camera);
        node.hidden=p.z < -1 || p.z > 1 || Math.abs(p.x)>1 || Math.abs(p.y)>1 || !rect.width || !rect.height;
        node.style.left=(rect.left+(p.x+1)*rect.width/2)+'px';node.style.top=(rect.top+(1-p.y)*rect.height/2)+'px';
      }
      for(const [key,node] of this.nodes)if(!keep.has(key)){node.remove();this.nodes.delete(key);}
    }
    hide(){this.root.hidden=true;}
    dispose(){this.root.remove();this.nodes.clear();}
  }
  window.RoomSeatLabels=RoomSeatLabels;
})();
