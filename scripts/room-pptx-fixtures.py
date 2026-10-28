"""Small synthetic OOXML documents; no downloaded/user material."""
import io, zipfile, sys
from pathlib import Path
P='http://schemas.openxmlformats.org/presentationml/2006/main'
A='http://schemas.openxmlformats.org/drawingml/2006/main'
R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
def entries(count=2):
    files={'[Content_Types].xml':f'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>'+''.join(f'<Override PartName="/ppt/slides/slide{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>' for i in range(1,count+1))+'</Types>',
    '_rels/.rels':f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="{R}/officeDocument" Target="ppt/presentation.xml"/></Relationships>',
    'ppt/presentation.xml':f'<p:presentation xmlns:p="{P}" xmlns:r="{R}"><p:sldIdLst>'+''.join(f'<p:sldId id="{255+i}" r:id="rId{i}"/>' for i in range(1,count+1))+'</p:sldIdLst><p:sldSz cx="9144000" cy="5143500"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>',
    'ppt/_rels/presentation.xml.rels':f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+''.join(f'<Relationship Id="rId{i}" Type="{R}/slide" Target="slides/slide{i}.xml"/>' for i in range(1,count+1))+'</Relationships>'}
    for i in range(1,count+1):
        files[f'ppt/slides/slide{i}.xml']=f'<p:sld xmlns:p="{P}" xmlns:a="{A}" xmlns:r="{R}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="500000" y="500000"/><a:ext cx="8000000" cy="2000000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="ru-RU" sz="3200"/><a:t>3DTalks — Проверка PPTX, слайд {i}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>'
    return files
def archive(files):
    out=io.BytesIO()
    with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
        for name,data in files.items():
            info=zipfile.ZipInfo(name,(2026,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o100600<<16;z.writestr(info,data)
    return out.getvalue()
def generate(directory):
    directory.mkdir(parents=True,exist_ok=True)
    good=entries();good['ppt/slides/slide1.xml']=good['ppt/slides/slide1.xml'].replace('<a:rPr lang="ru-RU" sz="3200"/>','<a:rPr lang="ru-RU" sz="3200"><a:hlinkClick r:id="hyperlink"/></a:rPr>');good['ppt/slides/_rels/slide1.xml.rels']=f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="hyperlink" Type="{R}/hyperlink" Target="https://example.invalid/not-requested" TargetMode="External"/></Relationships>';cases={'valid':good,'external':{**good,'ppt/slides/_rels/slide1.xml.rels':f'<Relationships><Relationship Id="x" Type="{R}/image" Target="file:///etc/passwd" TargetMode="External"/></Relationships>'},'macro':{**good,'ppt/vbaProject.bin':'macro sentinel'},'traversal':{**good,'../escape.txt':'bad'},'bomb':{**good,'ppt/media/data.png':'A'*200000},'slides-overflow':entries(101),'doctype':{**good,'ppt/slides/slide1.xml':f'<!DOCTYPE x [<!ENTITY a "test">]><p:sld xmlns:p="{P}"/>'}}
    for name,files in cases.items(): (directory/(name+'.pptx')).write_bytes(archive(files))
    (directory/'invalid.pptx').write_bytes(b'not an OOXML file')
if __name__=='__main__': generate(Path(sys.argv[1]))
