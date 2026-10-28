"""Synthetic workload decks: no user files or downloaded presentation assets."""
import importlib.util,struct,zlib,random,sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('base',Path(__file__).with_name('room-pptx-fixtures.py'));base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
def png(w,h,rng):
    def chunk(kind,data): return struct.pack('!I',len(data))+kind+data+struct.pack('!I',zlib.crc32(kind+data)&0xffffffff)
    data=zlib.compress(b''.join(b'\0'+rng.randbytes(w*3) for _ in range(h)),1)
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('!IIBBBBB',w,h,8,2,0,0,0))+chunk(b'IDAT',data)+chunk(b'IEND',b'')
def make(directory):
    directory.mkdir(parents=True,exist_ok=True);rng=random.Random(317)
    for count,images,name in [(20,0,'trial-text'),(20,3,'trial-images')]:
        files=base.entries(count)
        if images:
            files['[Content_Types].xml']=files['[Content_Types].xml'].replace('</Types>','<Default Extension="png" ContentType="image/png"/></Types>')
            for n in range(images): files[f'ppt/media/image{n}.png']=png(768,512,rng)
        for i in range(1,count+1):
            file=f'ppt/slides/slide{i}.xml'
            files[file]=files[file].replace('Проверка PPTX', 'Проверка PPTX — 日本語 中文 한글')
            if images:
                picture=f'<p:pic><p:nvPicPr><p:cNvPr id="3" name="Picture"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="image"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="500000" y="2200000"/><a:ext cx="3500000" cy="2300000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>'
                files[file]=files[file].replace('</p:spTree>',picture+'</p:spTree>')
                files[f'ppt/slides/_rels/slide{i}.xml.rels']=f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="image" Type="{base.R}/image" Target="../media/image{(i-1)%images}.png"/></Relationships>'
        (directory/(name+'.pptx')).write_bytes(base.archive(files))
if __name__=='__main__': make(Path(sys.argv[1]))
