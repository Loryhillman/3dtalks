"""Serial spool worker. No network/DB/secrets/Docker API; see compose.pptx.yaml."""
import os, sys, json, time, re, signal, subprocess, shutil, stat, fcntl
from pathlib import Path
from validate import inspect, Rejected
ROOT=Path(os.environ.get('PPTX_SPOOL','/spool'))
UUID=re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
OUTPUT=20*1024**2
CODES={'INVALID_PPTX','UNSUPPORTED_PPTX','PPTX_LIMIT_EXCEEDED','FILE_TOO_LARGE','TOO_MANY_PAGES','PPTX_CONVERSION_FAILED','PPTX_TIMEOUT','UPLOAD_CANCELLED'}
def atomic(path,data):
    tmp=path.with_name(path.name+'.tmp')
    with open(tmp,'w') as f: json.dump(data,f,separators=(',',':'))
    os.chmod(tmp,0o600);os.replace(tmp,path)
def bounded(path,size):
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(fd,'rb') as f:
        s=os.fstat(f.fileno())
        if not stat.S_ISREG(s.st_mode) or s.st_size>size: raise Rejected()
        return f.read(size+1)
def job(folder):
    profile=Path('/tmp/pptx-jobs')/folder.name
    try:
        bounded(folder/'input.pptx',5*1024**2)
        inspect(folder/'input.pptx')
        profile.mkdir(parents=True,exist_ok=False)
        # Very high macro security (3), no trusted locations. ZIP validation also
        # rejects active/OLE packages. Do not infer sandboxing from --headless.
        (profile/'user').mkdir()
        (profile/'user/registrymodifications.xcu').write_text("""<?xml version="1.0"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop><prop oor:name="SecureURL" oor:op="fuse"><value/></prop></item><item oor:path="/org.openoffice.Office.Java/VirtualMachine"><prop oor:name="Enable" oor:op="fuse"><value>false</value></prop></item></oor:items>""")
        options={'ExportNotesPages':{'type':'boolean','value':'false'},'ExportHiddenSlides':{'type':'boolean','value':'true'},'UseTransitionEffects':{'type':'boolean','value':'false'},'ExportFormFields':{'type':'boolean','value':'false'},'PDFViewSelection':{'type':'long','value':'3'}}
        command=['libreoffice','-env:UserInstallation='+profile.as_uri(),'--headless','--nologo','--nodefault','--nofirststartwizard','--norestore','--convert-to','pdf:impress_pdf_Export:'+json.dumps(options,separators=(',',':')),'--outdir',str(folder),str(folder/'input.pptx')]
        p=subprocess.run(command,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=115)
        output=folder/'input.pdf';data=bounded(output,OUTPUT)
        if p.returncode or not 0<len(data)<=OUTPUT or not data.startswith(b'%PDF-'): raise Rejected('PPTX_CONVERSION_FAILED')
        os.chmod(output,0o600);os.replace(output,folder/'output.pdf')
        atomic(folder/'outcome.json',{'ok':True})
    except subprocess.TimeoutExpired: atomic(folder/'outcome.json',{'ok':False,'code':'PPTX_TIMEOUT'})
    except Rejected as e: atomic(folder/'outcome.json',{'ok':False,'code':e.code})
    except Exception: atomic(folder/'outcome.json',{'ok':False,'code':'PPTX_CONVERSION_FAILED'})
def heartbeat(busy=None): atomic(ROOT/'heartbeat.json',{'version':1,'at':int(time.time()*1000),'busy':busy})
def serve():
    ROOT.mkdir(parents=True,exist_ok=True)
    lock=open(ROOT/'worker.lock','a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    while True:
        heartbeat()
        for folder in sorted(ROOT.iterdir()):
            if not UUID.fullmatch(folder.name) or folder.is_symlink() or not folder.is_dir() or not (folder/'request.json').exists() or (folder/'result.json').exists(): continue
            ident=folder.name;deadline=0;process=None;result={'ok':False,'code':'INVALID_PPTX'}
            try:
                request=json.loads(bounded(folder/'request.json',512))
                if set(request)!= {'version','id','deadlineMs'} or request['version']!=1 or request['id']!=ident or type(request['deadlineMs']) is not int: raise Rejected()
                deadline=request['deadlineMs']/1000
                if deadline>time.time()+125: raise Rejected()
                if time.time()>=deadline: raise Rejected('PPTX_TIMEOUT')
                if (folder/'cancel').exists(): raise Rejected('UPLOAD_CANCELLED')
                process=subprocess.Popen([sys.executable,__file__,'--job',str(folder)],start_new_session=True,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
                while process.poll() is None:
                    heartbeat(ident)
                    if (folder/'cancel').exists(): raise Rejected('UPLOAD_CANCELLED')
                    if time.time()>=deadline: raise Rejected('PPTX_TIMEOUT')
                    time.sleep(.1)
                result=json.loads(bounded(folder/'outcome.json',512))
                if set(result)-{'ok','code'} or type(result.get('ok')) is not bool: raise Rejected()
                if result.get('code') not in CODES and not result['ok']: raise Rejected()
            except Rejected as e: result={'ok':False,'code':e.code}
            except Exception: result={'ok':False,'code':'PPTX_CONVERSION_FAILED'}
            finally:
                if process:
                    try: os.killpg(process.pid,signal.SIGKILL)
                    except ProcessLookupError: pass
                    process.wait()
                shutil.rmtree(Path('/tmp/pptx-jobs')/ident,ignore_errors=True)
            # Terminal ack is published only after the process group is gone.
            atomic(folder/'result.json',{'version':1,'id':ident,**result})
        time.sleep(.3)
if __name__=='__main__':
    if len(sys.argv)>1 and sys.argv[1]=='--job': job(Path(sys.argv[2]))
    else: serve()
