// One process owns transfers/checking. Quotas and reservations are serialized in SQL.
module.exports=Object.freeze({pdfBytes:20*1024**2,imageBytes:8*1024**2,inputPixels:16000000,
  outputPixels:4000000,outputSide:2560,pages:100,ownerBytes:100*1024**2,ownerCount:20,
  serverBytes:1024**3,transfers:2,queue:4,checkMs:10000,heapMB:96,rssBytes:256*1024**2,
  idleMs:30000,uploadMs:120000,reserveMs:120000,processingLeaseMs:180000,
  historyMs:900000,cleanupBatch:20,diskMargin:32*1024**2,downloads:4,ownerDownloads:2,readMs:120000});
