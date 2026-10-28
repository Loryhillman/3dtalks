const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const Legacy=require('../public/js/roomPresentationProtocol'),V2=require('../public/js/roomPresentationProtocolV2'),Media=require('../public/js/roomMediaContract');
const roomId=randomUUID(),epoch=randomUUID(),id=randomUUID();
const envelope={protocolVersion:2,requestId:id,expectedEpoch:epoch,expectedRevision:'9007199254740993'};
for(const command of [{type:'play'},{type:'pause'},{type:'seek',positionMs:0},{type:'seek',positionMs:600000},{type:'show',assetId:id},{type:'page',pageIndex:99},{type:'stop'}]){
 const body={...envelope,command};assert(V2.command(body));assert(!Legacy.command(body),'V1 cannot accidentally accept V2 commands');
}
for(const command of [{type:'seek',positionMs:-1},{type:'seek',positionMs:600001},{type:'seek',positionMs:.5},{type:'seek',positionMs:NaN},{type:'seek',positionMs:Infinity},{type:'play',positionMs:1},{type:'play',userId:id},{type:'pause',url:'/secret'},{type:'page',pageIndex:100},null])assert(!V2.command({...envelope,command}));
for(const patch of [{protocolVersion:1},{protocolVersion:undefined},{expectedRevision:2},{expectedRevision:'01'},{expectedRevision:'9223372036854775808'},{requestId:'../file'},{roomId}])assert(!V2.command({...envelope,command:{type:'play'},...patch}));
const slides={roomId,epoch,revision:'9',asset:{id,name:'Slides',kind:'pdf',pageCount:2},pageIndex:1};
assert(Legacy.state(slides));assert(V2.state({...slides,protocolVersion:2,playback:null}));
assert(!V2.state({...slides,protocolVersion:2,playback:{status:'playing',positionMs:0,anchorServerTimeMs:1}}));
const state={protocolVersion:2,roomId,epoch,revision:'10',asset:{id,name:'Video',kind:'video',durationMs:10000,width:1920,height:1080},pageIndex:0,playback:{status:'playing',positionMs:500,anchorServerTimeMs:1700000000000}};
assert(V2.state(state));assert(V2.state({...state,asset:{...state.asset,width:1080,height:1920}}));assert(!V2.state({...state,asset:{...state.asset,width:1081,height:1920}}));assert(!Legacy.state(state));
assert(Legacy.state(V2.legacyState(state)));assert.equal(V2.legacyState(state).asset,null);
assert.deepEqual(V2.legacyState({...slides,protocolVersion:2,playback:null}),slides);
assert.equal(V2.legacyState({...state,pageIndex:1}),null);
for(const patch of [{pageIndex:1},{asset:{...state.asset,pageCount:1}},{asset:{...state.asset,durationMs:600001}},{asset:{...state.asset,width:1921}},{asset:{...state.asset,url:'https://example.invalid/video'}},{playback:{...state.playback,positionMs:10000}},{playback:{...state.playback,positionMs:10001}},{playback:{...state.playback,anchorServerTimeMs:Infinity}},{playback:{...state.playback,status:'paused'}},{playback:null},{token:'secret'}])assert(!V2.state({...state,...patch}));
assert(V2.state({...state,playback:{status:'paused',positionMs:10000,anchorServerTimeMs:null}}));
assert(V2.state({...slides,protocolVersion:2,asset:null,pageIndex:0,playback:null}));
assert(V2.capabilitiesResult({protocolVersion:2,features:Media.features()}));
assert(!V2.capabilitiesResult({protocolVersion:2,features:{videoUpload:false,videoPlayback:true,pptxImport:false}}));
assert(!V2.capabilitiesResult({protocolVersion:2,features:{videoUpload:false,videoPlayback:false}}));
assert(!V2.capabilitiesResult({protocolVersion:2,features:{...Media.features(),token:'secret'}}));
assert(V2.capabilities({protocolVersion:2}));assert(!V2.capabilities({protocolVersion:2,userId:id}));
assert(V2.clockRequest({protocolVersion:2,nonce:id}));assert(!V2.clockRequest({protocolVersion:2,nonce:'bad'}));
assert(V2.clockResponse({protocolVersion:2,nonce:id,receivedAtMs:10,sentAtMs:11}));
for(const patch of [{sentAtMs:9},{receivedAtMs:NaN},{sentAtMs:8640000000000001},{nonce:'bad'},{roomId}])assert(!V2.clockResponse({protocolVersion:2,nonce:id,receivedAtMs:10,sentAtMs:11,...patch}));
assert.deepEqual(Media.importLimits,{video:{bytes:20*1024**2,durationMs:180000},pptx:{bytes:5*1024**2,pages:20}});
// Released 10-minute assets remain valid for playback despite stricter import caps.
const metadata={durationMs:600000,width:1920,height:1080,fps:30,codec:'h264',pixelFormat:'yuv420p',audioCodec:'aac'};assert(Media.videoMetadata(metadata));assert(Media.videoMetadata({...metadata,width:1080,height:1920}));assert(Media.videoMetadata({...metadata,audioCodec:null}));
for(const patch of [{durationMs:600001},{width:1921},{height:1081},{fps:30.01},{fps:NaN},{fps:Infinity},{codec:'hevc'},{pixelFormat:'yuv444p'},{audioCodec:'opus'},{audioCodec:undefined},{path:'../secret'}])assert(!Media.videoMetadata({...metadata,...patch}));
assert.deepEqual(Media.features(),{videoUpload:false,videoPlayback:false,pptxImport:false});
assert.equal(Media.features({ROOM_VIDEO_PLAYBACK_ENABLED:'true'}).videoPlayback,false);
assert.equal(Media.features({ROOM_VIDEO_UPLOAD_ENABLED:'TRUE'}).videoUpload,false);
assert.deepEqual(Media.features({ROOM_VIDEO_UPLOAD_ENABLED:'true',ROOM_VIDEO_PLAYBACK_ENABLED:'true',ROOM_PPTX_IMPORT_ENABLED:'true'}),{videoUpload:true,videoPlayback:true,pptxImport:true});
const context={};context.window=context;require('node:vm').createContext(context);
for(const file of ['roomMediaContract','roomPresentationProtocol','roomPresentationProtocolV2'])require('node:vm').runInContext(require('node:fs').readFileSync(require.resolve('../public/js/'+file),'utf8'),context);
assert(context.RoomPresentationProtocolV2.state(state));assert(context.RoomPresentationProtocol.state(context.RoomPresentationProtocolV2.legacyState(state)));
console.log('V2 contracts: explicit version, V1 isolation, exact shapes, bounded codecs/positions/timestamps, clock and disabled-by-default features passed.');

(async()=>{
 const service=require('../src/services/roomMedia').createRoomMediaService({connect(){throw Error('Oversized upload reached SQL');}},{features:()=>({videoUpload:true,videoPlayback:true,pptxImport:true})});
 try{
  for(const body of [{kind:'video',bytes:20*1024**2+1},{kind:'pdf',sourceFormat:'pptx',bytes:5*1024**2+1}])
   await assert.rejects(service.reserve(randomUUID(),randomUUID(),{requestId:randomUUID(),name:'Trial',...body}),e=>e.code==='FILE_TOO_LARGE'&&e.status===413);
  console.log('Trial upload reservations: oversized video/PPTX rejected before SQL or conversion.');
 }finally{service.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
