// Small authored PDFs with real xref tables; no third-party documents.
function pdf({pages=2,rotate=0,width=600,height=400,script=false}={}){
  const objects=[`<< /Type /Catalog /Pages 2 0 R ${script?'/OpenAction '+(pages*2+3)+' 0 R':''} >>`,`<< /Type /Pages /Count ${pages} /Kids [${Array.from({length:pages},(_,i)=>`${i*2+3} 0 R`).join(' ')}] >>`];
  for(let i=0;i<pages;i++){
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Rotate ${rotate} /Resources << >> /Contents ${i*2+4} 0 R >>`);
    const stream=`${i%2?'0 0 1':'1 0 0'} rg 0 0 ${width} ${height} re f\n`;
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`);
  }
  if(script)objects.push('<< /S /JavaScript /JS (globalThis.fixturePdfExecuted = true) >>');
  let text='%PDF-1.7\n',offsets=[0];
  objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(text));text+=`${i+1} 0 obj\n${o}\nendobj\n`;});
  const start=Buffer.byteLength(text);text+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  text+=offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('');
  text+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;return Buffer.from(text);
}
module.exports={pdf};
