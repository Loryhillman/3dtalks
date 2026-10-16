/* One document and one cancellable render task. No annotation, form or scripting layer. */
(() => {
  const base='/vendor/room-pdf/5.5.207/';let library;
  async function pdfjs(){
    if(!library)library=import(base+'legacy/build/pdf.mjs').then(lib=>{
      lib.GlobalWorkerOptions.workerSrc=base+'legacy/build/pdf.worker.mjs';return lib;
    }).catch(e=>{library=null;throw e;});return library;
  }
  const abort=()=>Object.assign(new Error('Cancelled'),{name:'AbortError'});
  class RoomMediaRenderer {
    constructor(canvas){this.canvas=canvas;this.generation=0;this.renderGeneration=0;this.pageCount=0;}
    async clear(){
      const generation=++this.generation;++this.renderGeneration;
      this.controller?.abort();const render=this.renderTask,task=this.loadingTask;
      this.renderTask=this.loadingTask=this.document=null;this.pageCount=0;
      render?.cancel();await render?.promise.catch(()=>{});await task?.destroy().catch(()=>{});
      if(generation===this.generation)this.canvas.width=this.canvas.height=0;
      return generation;
    }
    async load({url,kind,headers}){
      const generation=await this.clear();if(generation!==this.generation)throw abort();
      const controller=this.controller=new AbortController();
      const response=await fetch(url,{headers,signal:controller.signal,cache:'no-store'});
      if(!response.ok)throw Object.assign(new Error('MATERIAL_NOT_FOUND'),{code:'MATERIAL_NOT_FOUND'});
      if(generation!==this.generation)throw abort();
      if(kind==='pdf'){
        const data=new Uint8Array(await response.arrayBuffer());if(data.byteLength>20*1024**2)throw Error('FILE_TOO_LARGE');
        const lib=await pdfjs();if(generation!==this.generation)throw abort();
        const task=this.loadingTask=lib.getDocument({data,isEvalSupported:false,enableXfa:false,stopAtErrors:true,
          cMapUrl:base+'cmaps/',cMapPacked:true,standardFontDataUrl:base+'standard_fonts/',wasmUrl:base+'wasm/',
          iccUrl:base+'iccs/',maxImageSize:16000000,canvasMaxAreaInBytes:16000000});
        task.onPassword=()=>task.destroy();
        const doc=await task.promise;if(generation!==this.generation){await task.destroy();throw abort();}
        if(doc.numPages<1||doc.numPages>100){await task.destroy();throw Error('INVALID_PDF');}
        this.document=doc;this.pageCount=doc.numPages;await this.page(0);
      }else{
        const blob=await response.blob();if(blob.size>8*1024**2)throw Error('FILE_TOO_LARGE');
        const bitmap=await createImageBitmap(blob);
        try{
          if(generation!==this.generation)throw abort();
          const size=this.size(bitmap.width,bitmap.height,1);this.canvas.width=size.width;this.canvas.height=size.height;
          this.canvas.getContext('2d').drawImage(bitmap,0,0,size.width,size.height);this.pageCount=1;
        }finally{bitmap.close();}
      }
      return this.pageCount;
    }
    size(width,height,desired=2){
      if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw Error('INVALID_PDF');
      const scale=Math.min(desired,4096/width,4096/height,Math.sqrt(4000000/(width*height)));
      return {width:Math.max(1,Math.floor(width*scale)),height:Math.max(1,Math.floor(height*scale)),scale};
    }
    async page(index){
      const doc=this.document,generation=this.generation,renderGeneration=++this.renderGeneration;
      if(!doc||!Number.isInteger(index)||index<0||index>=doc.numPages)throw Error('INVALID_PAGE');
      const old=this.renderTask;old?.cancel();await old?.promise.catch(()=>{});
      const page=await doc.getPage(index+1);
      if(generation!==this.generation||renderGeneration!==this.renderGeneration)throw abort();
      const original=page.getViewport({scale:1}),size=this.size(original.width,original.height);
      const viewport=page.getViewport({scale:size.scale});this.canvas.width=size.width;this.canvas.height=size.height;
      const task=this.renderTask=page.render({canvasContext:this.canvas.getContext('2d'),viewport,annotationMode:0});
      try{await task.promise;}finally{if(this.renderTask===task)this.renderTask=null;page.cleanup();}
      if(generation!==this.generation||renderGeneration!==this.renderGeneration)throw abort();
      return this.canvas;
    }
  }
  window.RoomMediaRenderer=RoomMediaRenderer;
})();
