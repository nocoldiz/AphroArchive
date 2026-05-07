// public/worker.js - Offloads heavy filtering/sorting from the UI thread
self.onmessage = function(e) {
  const { type, data, requestId } = e.data;
  
  if (type === 'filter') {
    const { videos, bookmarks, galleryFilter, recentMode, favM, srcFilter, recentVids, shuf, sort } = data;
    
    let base = recentMode ? recentVids : (favM ? videos.filter(v => v.fav) : videos);
    
    if (galleryFilter) {
      const gf = galleryFilter.toLowerCase();
      base = base.filter(v => 
        v.name.toLowerCase().includes(gf) || 
        (v.category && v.category.toLowerCase().includes(gf)) ||
        (v.tags && v.tags.some(t => t.toLowerCase().includes(gf)))
      );
    }

    // Apply sorting in worker
    if (shuf) {
      base.sort(() => Math.random() - 0.5);
    } else {
      if (sort === 'name')          base.sort((a, b) => a.name.localeCompare(b.name));
      else if (sort === 'size')     base.sort((a, b) => b.size - a.size);
      else if (sort === 'duration') base.sort((a, b) => (b.duration || 0) - (a.duration || 0));
      else                          base.sort((a, b) => b.mtime - a.mtime);
    }

    const localResult = srcFilter === 'remote' ? [] : base;
    let bookmarksResult = (!recentMode && !favM && srcFilter !== 'local') ? bookmarks : [];
    
    if (galleryFilter) {
      const gf = galleryFilter.toLowerCase();
      bookmarksResult = bookmarksResult.filter(it => 
        it.title.toLowerCase().includes(gf) || 
        it.url.toLowerCase().includes(gf)
      );
    }

    self.postMessage({ 
      type: 'filterResult', 
      local: localResult, 
      finalBms: bookmarksResult,
      requestId 
    });
  }
};
