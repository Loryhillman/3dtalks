import unittest, importlib.util, tempfile, zipfile, io
from pathlib import Path
from validate import inspect, Rejected
spec=importlib.util.spec_from_file_location('fixtures',Path(__file__).parents[2]/'scripts/room-pptx-fixtures.py')
fixtures=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixtures)
class TestValidation(unittest.TestCase):
    def test_generated_documents(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);fixtures.generate(root)
            self.assertEqual(inspect(root/'valid.pptx'),2)
            for name in ['external','macro','traversal','bomb','slides-overflow','doctype','invalid']:
                with self.subTest(name=name),self.assertRaises(Rejected): inspect(root/(name+'.pptx'))
    def test_duplicate_and_symlink(self):
        with tempfile.TemporaryDirectory() as d:
            for bad in ['duplicate','symlink','backslash','crc','missing-part']:
                out=io.BytesIO()
                with zipfile.ZipFile(out,'w') as z:
                    for name,data in fixtures.entries().items(): z.writestr(name,data)
                    if bad=='duplicate': z.writestr('PPT/presentation.xml','duplicate')
                    if bad=='symlink':
                        entry=zipfile.ZipInfo('ppt/evil');entry.external_attr=0o120777<<16;z.writestr(entry,'/etc/passwd')
                    if bad=='backslash': z.writestr('ppt\\evil.xml','bad')
                data=out.getvalue()
                if bad=='missing-part':
                    files=fixtures.entries();files['ppt/_rels/presentation.xml.rels']=files['ppt/_rels/presentation.xml.rels'].replace('slides/slide1.xml','slides/missing.xml');data=fixtures.archive(files)
                if bad=='crc': data=data.replace(b'3DTalks',b'4DTalks',1)
                file=Path(d)/'bad.pptx';file.write_bytes(data)
                with self.subTest(name=bad),self.assertRaises(Rejected): inspect(file)
if __name__=='__main__': unittest.main()
