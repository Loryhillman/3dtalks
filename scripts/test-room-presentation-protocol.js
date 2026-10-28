const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),P=require('../public/js/roomPresentationProtocol');
const room=randomUUID(),epoch=randomUUID(),id=randomUUID();
const command={requestId:id,expectedEpoch:epoch,expectedRevision:'9007199254740993',command:{type:'page',pageIndex:99}};
assert(P.command(command));assert(P.command({...command,command:{type:'stop'}}));assert(P.command({...command,command:{type:'show',assetId:id.toUpperCase()}}));
for(const patch of [{roomId:room},{userId:room},{expectedRevision:1},{expectedRevision:'01'},{expectedRevision:'9223372036854775808'},
 {command:{type:'page',pageIndex:-1}},{command:{type:'page',pageIndex:100}},{command:{type:'page',pageIndex:1,url:'https://example.com'}},{command:{type:'show',assetId:'../../secret'}},{command:null}])assert(!P.command({...command,...patch}));
const state={roomId:room,epoch,revision:'1',asset:{id,name:'Fixture',kind:'pdf',pageCount:2},pageIndex:1};assert(P.state(state));
for(const patch of [{pageIndex:2},{epoch:'bad'},{asset:{...state.asset,token:'secret'}},{asset:{...state.asset,kind:'image'}},{revision:2},{asset:null}])assert(!P.state({...state,...patch}));
assert(P.state({...state,asset:null,pageIndex:0}));
assert(P.session({roomId:room,epoch,token:'a'.repeat(43),canControl:false}));
assert(!P.session({roomId:room,epoch,token:'a'.repeat(43),canControl:true,userId:room}));
assert(!P.session({roomId:room,epoch,token:'short',canControl:false}));
console.log('Presentation protocol: bounded exact command/state/session shapes, UUIDs, page bounds, bigint decimal revisions and unknown-field rejection OK');
