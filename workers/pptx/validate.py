"""Bounded, non-extracting OOXML inspection before LibreOffice sees the file."""
import os, re, stat, zipfile, posixpath
import xml.etree.ElementTree as ET
from urllib.parse import unquote, urlsplit
INPUT=20*1024**2
EXPANDED=200*1024**2
XML_LIMIT=8*1024**2
NS='http://schemas.openxmlformats.org/presentationml/2006/main'
CT='application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml'
class Rejected(Exception):
    def __init__(self, code='INVALID_PPTX'): self.code=code

def inspect(file):
    if not 0 < os.stat(file).st_size <= INPUT: raise Rejected('FILE_TOO_LARGE')
    total=0; names=set(); slides=set(); presentation=None; content=None; package_rels=None
    try:
        with zipfile.ZipFile(file) as archive:
            entries=archive.infolist()
            if not 1 <= len(entries) <= 4096: raise Rejected('PPTX_LIMIT_EXCEEDED')
            parts={e.filename for e in entries if not e.is_dir()}
            for entry in entries:
                name=entry.filename
                if (not name or len(name)>240 or '\\' in name or '\x00' in name or name.startswith('/')
                    or ':' in name or any(p in ('.','..','') for p in name.rstrip('/').split('/'))
                    or name.casefold() in names or entry.flag_bits&1
                    or entry.compress_type not in (zipfile.ZIP_STORED,zipfile.ZIP_DEFLATED)
                    or stat.S_ISLNK(entry.external_attr>>16)):
                    raise Rejected()
                names.add(name.casefold())
                if entry.is_dir(): continue
                if entry.file_size>EXPANDED or entry.file_size>max(1,entry.compress_size)*200:
                    raise Rejected('PPTX_LIMIT_EXCEEDED')
                lower=name.lower()
                if any(x in lower for x in ('vbaproject','activex','/embeddings/','/oleobject','customui/')):
                    raise Rejected('UNSUPPORTED_PPTX')
                if lower.endswith(('.bin','.exe','.dll','.vbs','.js','.mhtml','.htm','.html')):
                    raise Rejected('UNSUPPORTED_PPTX')
                is_xml=lower.endswith(('.xml','.rels')) or name=='[Content_Types].xml'
                chunks=[]; size=0
                with archive.open(entry) as stream:
                    while True:
                        chunk=stream.read(65536)
                        if not chunk: break
                        size+=len(chunk);total+=len(chunk)
                        if size>EXPANDED or total>EXPANDED or is_xml and size>XML_LIMIT:
                            raise Rejected('PPTX_LIMIT_EXCEEDED')
                        if is_xml: chunks.append(chunk)
                if size!=entry.file_size: raise Rejected()
                if not is_xml: continue
                data=b''.join(chunks)
                # Forbid DTD/entity declarations even if encoded as UTF-16/32.
                if b'<!DOCTYPE' in data.replace(b'\0',b'').upper() or b'<!ENTITY' in data.replace(b'\0',b'').upper():
                    raise Rejected('UNSUPPORTED_PPTX')
                doc=ET.fromstring(data)
                if name=='[Content_Types].xml': content=doc
                if name=='ppt/presentation.xml': presentation=doc
                if name=='_rels/.rels': package_rels=doc
                if re.fullmatch(r'ppt/slides/slide[0-9]+\.xml',name):
                    if doc.tag!='{'+NS+'}sld': raise Rejected()
                    slides.add('/'+name)
                if lower.endswith('.rels'):
                    for rel in doc:
                        target=rel.get('Target','');kind=rel.get('Type','').rsplit('/',1)[-1].lower()
                        if kind in ('oleobject','package','control','vbaproject','attachedtemplate','audio','video','altchunk'):
                            raise Rejected('UNSUPPORTED_PPTX')
                        if rel.get('TargetMode')=='External':
                            if kind!='hyperlink' or urlsplit(target).scheme not in ('https','http','mailto'):
                                raise Rejected('UNSUPPORTED_PPTX')
                        else:
                            decoded=unquote(target)
                            if '\\' in decoded or '\x00' in decoded or ':' in decoded or decoded.startswith('//'):
                                raise Rejected('UNSUPPORTED_PPTX')
                            base=posixpath.dirname(posixpath.dirname(name));target_path=urlsplit(decoded).path
                            source_part=posixpath.join(base,posixpath.basename(name)[:-5])
                            normalized=posixpath.normpath(posixpath.join(base,target_path) if not target_path.startswith('/') else target_path.lstrip('/')) if target_path else source_part
                            if normalized.startswith('../') or normalized=='..': raise Rejected('UNSUPPORTED_PPTX')
                            if normalized not in parts: raise Rejected()
            if presentation is None or content is None or package_rels is None: raise Rejected()
            if presentation.tag!='{'+NS+'}presentation': raise Rejected()
            slide_ids=presentation.findall('{'+NS+'}sldIdLst/{'+NS+'}sldId')
            if not 1 <= len(slide_ids) <= 100 or not 1 <= len(slides) <= 100:
                raise Rejected('TOO_MANY_PAGES')
            if len(slide_ids)!=len(slides): raise Rejected()
            ctypes={n.get('PartName'):n.get('ContentType') for n in content}
            if ctypes.get('/ppt/presentation.xml')!=CT: raise Rejected('UNSUPPORTED_PPTX')
            if any(any(x in (n.get('ContentType','').lower()) for x in ('macroenabled','oleobject','activex','vba','audio/','video/')) for n in content):
                raise Rejected('UNSUPPORTED_PPTX')
            if not any(n.get('Type','').endswith('/officeDocument') and n.get('Target','').lstrip('/')=='ppt/presentation.xml' for n in package_rels):
                raise Rejected()
            return len(slide_ids)
    except (zipfile.BadZipFile,RuntimeError,ET.ParseError,ValueError,UnicodeError,NotImplementedError) as e:
        raise Rejected() from e
