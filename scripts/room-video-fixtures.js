const {execFileSync}=require('node:child_process'),path=require('node:path'),{randomUUID}=require('node:crypto');
function video(directory,{codec='libx264',fps=24,audio=true,duration=2,width=160,height=90,preset=null,faststart=false}={}){
 const file=path.join(directory,randomUUID()+'.mp4');
 const args=['-v','error','-threads','1','-f','lavfi','-i',`color=c=blue:size=${width}x${height}:rate=${fps}:duration=${duration}`];
 if(audio)args.push('-f','lavfi','-i',`sine=frequency=440:sample_rate=44100:duration=${duration}`);
 args.push('-c:v',codec,'-threads','1','-pix_fmt','yuv420p');
 if(faststart)args.push('-movflags','+faststart');
 if(preset)args.push('-preset',preset);
 if(audio)args.push('-c:a','aac','-ac','1');args.push('-y',file);
 execFileSync('ffmpeg',args,{timeout:60000,stdio:['ignore','ignore','pipe']});return file;
}
module.exports={video};
