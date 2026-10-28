/** Estimate server time against performance.now(), avoiding local wall-clock jumps. */
(() => {
 class RoomVideoClock {
  constructor(send){this.send=send;this.pending=new Map();this.offset=Date.now()-performance.now();this.best=Infinity;this.timers=[];}
  start(){for(let i=0;i<3;i++)this.timers.push(setTimeout(()=>this.sample(),i*350));this.interval=setInterval(()=>{this.best=Infinity;this.sample();},20000);}
  sample(){const time=performance.now();for(const [id,p] of this.pending)if(time-p>5000)this.pending.delete(id);if(this.pending.size>=3)return;
   const nonce=RoomPresentationProtocol.requestId();this.pending.set(nonce,time);this.send('ROOM_PRESENTATION_CLOCK',{protocolVersion:2,nonce});}
  message(value){if(!RoomPresentationProtocolV2.clockResponse(value))return;const start=this.pending.get(value.nonce);if(start===undefined)return;this.pending.delete(value.nonce);
   const end=performance.now(),rtt=end-start-(value.sentAtMs-value.receivedAtMs);if(rtt<0||end-start>5000||rtt>this.best)return;
   this.best=rtt;this.offset=(value.receivedAtMs+value.sentAtMs)/2-(start+end)/2;}
  now(){return performance.now()+this.offset;}
  close(){this.timers.forEach(clearTimeout);clearInterval(this.interval);this.pending.clear();}
 }
 window.RoomVideoClock=RoomVideoClock;
})();
