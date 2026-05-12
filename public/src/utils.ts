export function extractActorNames(title: string, knownActors: string[] = []): string[] {
  const found = new Set(knownActors);

  let t = title.replace(/\.[a-z0-9]{2,5}$/i, '').trim();

  t.replace(/\b([A-Za-z]+_[A-Za-z]+(?:_[A-Za-z]+)*)\b/g, (_, g) => {
    found.add(g.replace(/_/g, ' '));
    return _;
  });
  t = t.replace(/_/g, ' ');

  (t.match(/\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g) || []).forEach(w => found.add(w));

  const stop = new Set([
    'video','the','a','an','in','on','at','to','for','of','or','but',
    'makes','make','takes','take','adores','adore','loves','love',
    'watches','watch','shopping','fitting','room','night','romantic',
    'amend','cry','him','her','them','from','by','hot','sexy',
    'goes','going','wants','gets','got','part','episode','scene',
    'compilation','vol','ft','feat','his','their','our','your','my',
    'he','she','they','we','you','i','tv','rfc'
  ]);

  function capSeqs(text: string) {
    const results: string[] = [], words = text.split(/\s+/);
    let cur: string[] = [];
    for (const w of words) {
      const c = w.replace(/[^a-zA-Z]/g, '');
      if (c.length > 1 && /^[A-Z][a-z]/.test(c) && !stop.has(c.toLowerCase())) {
        cur.push(c);
      } else {
        if (cur.length) { results.push(cur.join(' ')); cur = []; }
      }
    }
    if (cur.length) results.push(cur.join(' '));
    return results;
  }

  const verbPat = /\b(makes?\s+\w+(?:\s+\w+)?\s+for|adores?|loves?|takes?\b|watches?|goes?\s+\w+|and)\b/i;
  const dashSegs = t.split(/\s*[–—]\s*/);

  for (const seg of dashSegs) {
    const vm = seg.match(verbPat);
    if (vm) {
      const vi = seg.search(verbPat);
      const before = seg.slice(0, vi).trim();
      const after  = seg.slice(vi + vm[0].length).trim();
      capSeqs(before).forEach(n => found.add(n));
      const afterSeqs = capSeqs(after);
      if (afterSeqs.length) found.add(afterSeqs[0]);
    }

    const wm = seg.match(/\bwith\s+([A-Z][^–—]+?)(?=\s*$|\s*[,–—]|$)/);
    if (wm) {
      (wm[1] + ',' + seg.slice(seg.indexOf(wm[0]) + wm[0].length))
        .split(/,\s*/).forEach(p => capSeqs(p.trim()).forEach(n => found.add(n)));
    }
    const wm2 = seg.match(/\bwith\s+(.+)/i);
    if (wm2) wm2[1].split(/,\s*/).forEach(p => capSeqs(p.trim()).forEach(n => found.add(n)));

    const fm = seg.match(/\b(?:featuring|feat\.?)\s+([A-Z][^,–—]+)/i);
    if (fm) capSeqs(fm[1].trim()).forEach(n => found.add(n));

    const andRe = /\band\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)/g;
    let am;
    while ((am = andRe.exec(seg)) !== null) capSeqs(am[1]).forEach(n => found.add(n));
  }

  if (dashSegs.length > 1) {
    const first = dashSegs[0].trim();
    const words = first.split(/\s+/);
    if (words.length === 1) {
      if (/^[A-Z][a-zA-Z]+$/.test(first) && !/^[A-Z]{2,}$/.test(first)) found.add(first);
    } else if (!verbPat.test(first)) {
      first.split(/,\s*/).forEach(p => capSeqs(p.trim()).forEach(n => found.add(n)));
    }
  }

  return [...found].filter(n => n && n.length > 1 && !stop.has(n.toLowerCase()));
}
