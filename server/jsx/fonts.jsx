// Fonts InDesign can use right now (installed, plus any activated from Adobe Fonts). ARGS: search, limit.
var names = app.fonts.everyItem().name, fam = {}, order = [], q = ARGS.search ? ARGS.search.toLowerCase() : null;
for (var i = 0; i < names.length; i++) {
  var parts = String(names[i]).split('\t'), f = parts[0];
  if (q && f.toLowerCase().indexOf(q) < 0) continue;
  if (!fam[f]) { fam[f] = []; order.push(f); }
  fam[f].push(parts[1] || 'Regular');
}
order.sort();
var out = [], lim = ARGS.limit || 150;
for (i = 0; i < order.length && i < lim; i++) out.push({ family: order[i], styles: fam[order[i]] });
return { families: order.length, shown: out.length, fonts: out };
