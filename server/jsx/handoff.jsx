// Handoff check: what a printer or the next person needs, read-only. ARGS: path.
// Links (missing, out of date, embedded, low resolution, RGB), fonts (missing, substituted, Adobe Fonts,
// not embeddable), overset stories, hidden or non-printing layers, and whether the document is saved.
var d = __docAt(), i;
var r = { document: d.name, saved: d.saved, modified: d.modified, path: d.saved ? d.fullName.fsName : null,
  pages: d.pages.length, links: { total: d.links.length, missing: [], outOfDate: [], embedded: [], inaccessible: [], lowRes: [], rgb: [] },
  fonts: { total: 0, missing: [], substituted: [], fauxed: [], adobeFonts: [], noEmbedding: [], restricted: [] },
  overset: [], layers: { hidden: [], nonPrinting: [] } };

for (i = 0; i < d.links.length; i++) {
  var l = d.links[i], name = String(l.name), st = l.status;
  if (st === LinkStatus.LINK_MISSING) r.links.missing.push(name);
  else if (st === LinkStatus.LINK_OUT_OF_DATE) r.links.outOfDate.push(name);
  else if (st === LinkStatus.LINK_EMBEDDED) r.links.embedded.push(name);
  else if (st === LinkStatus.LINK_INACCESSIBLE) r.links.inaccessible.push(name);
  var g = l.parent;
  try {
    if (g && g.hasOwnProperty('effectivePpi')) {
      var ppi = g.effectivePpi, low = Math.min(ppi[0], ppi[1]);
      var page = null; try { page = g.parentPage ? g.parentPage.name : null; } catch (e) {}
      if (low && low < 300) r.links.lowRes.push({ link: name, ppi: Math.round(low), page: page });
      if (String(g.space) === 'RGB') r.links.rgb.push({ link: name, page: page });
    }
  } catch (e) {}
}

var fonts = d.fonts; r.fonts.total = fonts.length;
for (i = 0; i < fonts.length; i++) {
  var f = fonts[i], fn = String(f.name).replace(/\t/g, ' '), loc = '';
  try { loc = String(f.location); } catch (e) {}
  if (f.status === FontStatus.NOT_AVAILABLE) r.fonts.missing.push(fn);
  else if (f.status === FontStatus.SUBSTITUTED) r.fonts.substituted.push(fn);
  else if (f.status === FontStatus.FAUXED) r.fonts.fauxed.push(fn);
  // Activated from Adobe Fonts: Package does not copy them; the recipient activates them in Creative Cloud.
  if (/CoreSync|livetype/i.test(loc)) r.fonts.adobeFonts.push(fn);
  try { if (f.status === FontStatus.INSTALLED && !f.allowPDFEmbedding) r.fonts.noEmbedding.push(fn); } catch (e) {}
  try { if (f.restrictedPrinting) r.fonts.restricted.push(fn); } catch (e) {}
}

for (i = 0; i < d.stories.length; i++) {
  var s = d.stories[i];
  if (!s.overflows) continue;
  var where = null, ctr = s.textContainers;
  try { var last = ctr[ctr.length - 1]; where = last.parentPage ? last.parentPage.name : 'pasteboard'; } catch (e) {}
  var start = String(s.paragraphs.length ? s.paragraphs[0].contents : '').replace(/[\r\n]+/g, ' ').substr(0, 60);
  r.overset.push({ startsWith: start, lastFrameOnPage: where });
}

for (i = 0; i < d.layers.length; i++) {
  var ly = d.layers[i];
  if (!ly.visible) r.layers.hidden.push(String(ly.name));
  if (!ly.printable) r.layers.nonPrinting.push(String(ly.name));
}
return r;
