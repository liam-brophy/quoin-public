// Unused styles. ARGS: remove (names to delete; omit for a report). Never removes a style that a used style,
// an object style, a TOC style or footnote options depend on.
var d = __docAt(), i, j;
var usedP = {}, usedC = {};
function scanText(t) {
  try { var ps = t.paragraphs.everyItem().appliedParagraphStyle; for (var a = 0; a < ps.length; a++) usedP[ps[a].name] = true; } catch (e) {}
  try { var cs = t.textStyleRanges.everyItem().appliedCharacterStyle; for (var b = 0; b < cs.length; b++) usedC[cs[b].name] = true; } catch (e) {}
}
for (i = 0; i < d.stories.length; i++) {
  var st = d.stories[i];
  scanText(st);
  for (j = 0; j < st.footnotes.length; j++) scanText(st.footnotes[j]);
  try { for (j = 0; j < st.tables.length; j++) { var cells = st.tables[j].cells; for (var c = 0; c < cells.length; c++) scanText(cells[c]); } } catch (e) {}
}
// Styles other things depend on.
var keepP = {}, keepC = {}, why = {};
function keep(map, name, reason) { if (name && !map[name]) { map[name] = true; why[name] = reason; } }
var allP = d.allParagraphStyles, allC = d.allCharacterStyles;
for (i = 0; i < allP.length; i++) {
  var p = allP[i]; if (!usedP[p.name]) continue;
  var b = p; try { while (b.basedOn && b.basedOn.name) { b = b.basedOn; keep(keepP, b.name, 'parent of ' + p.name); } } catch (e) {}
  try { if (p.nextStyle && p.nextStyle.name) keep(keepP, p.nextStyle.name, 'next style of ' + p.name); } catch (e) {}
  try { for (j = 0; j < p.nestedStyles.length; j++) keep(keepC, p.nestedStyles[j].appliedCharacterStyle.name, 'nested style in ' + p.name); } catch (e) {}
  try { for (j = 0; j < p.nestedGrepStyles.length; j++) keep(keepC, p.nestedGrepStyles[j].appliedCharacterStyle.name, 'GREP style in ' + p.name); } catch (e) {}
  try { keep(keepC, p.dropCapStyle.name, 'drop cap in ' + p.name); } catch (e) {}
  try { keep(keepC, p.bulletsCharacterStyle.name, 'bullets in ' + p.name); keep(keepC, p.numberingCharacterStyle.name, 'numbering in ' + p.name); } catch (e) {}
}
for (i = 0; i < allC.length; i++) { var cc = allC[i]; if (!usedC[cc.name]) continue; try { var cb = cc; while (cb.basedOn && cb.basedOn.name) { cb = cb.basedOn; keep(keepC, cb.name, 'parent of ' + cc.name); } } catch (e) {} }
for (i = 0; i < d.allObjectStyles.length; i++) { try { keep(keepP, d.allObjectStyles[i].appliedParagraphStyle.name, 'object style ' + d.allObjectStyles[i].name); } catch (e) {} }
for (i = 0; i < d.tocStyles.length; i++) { try { var es = d.tocStyles[i].tocStyleEntries; for (j = 0; j < es.length; j++) { keep(keepP, es[j].name, 'TOC style ' + d.tocStyles[i].name); keep(keepP, es[j].formatStyle.name, 'TOC style ' + d.tocStyles[i].name); } } catch (e) {} }
try { keep(keepP, d.footnoteOptions.footnoteTextStyle.name, 'footnote options'); keep(keepC, d.footnoteOptions.footnoteMarkerStyle.name, 'footnote options'); } catch (e) {}
function root(n) { return /^\[/.test(n); }
var unusedP = [], unusedC = [], keptP = [], keptC = [];
for (i = 0; i < allP.length; i++) { var n = allP[i].name; if (usedP[n] || root(n)) continue; if (keepP[n]) keptP.push(n + ' (' + why[n] + ')'); else unusedP.push(n); }
for (i = 0; i < allC.length; i++) { var m = allC[i].name; if (usedC[m] || root(m)) continue; if (keepC[m]) keptC.push(m + ' (' + why[m] + ')'); else unusedC.push(m); }
var removed = [], failed = [];
if (ARGS.remove) {
  var ok = {}; for (i = 0; i < unusedP.length; i++) ok['p:' + unusedP[i]] = true; for (i = 0; i < unusedC.length; i++) ok['c:' + unusedC[i]] = true;
  for (i = 0; i < ARGS.remove.length; i++) {
    // Look the style up afresh each time: InDesign refers to styles by position, so a removal shifts the rest.
    var r = ARGS.remove[i], s = null, list = null;
    if (ok['p:' + r]) list = d.allParagraphStyles; else if (ok['c:' + r]) list = d.allCharacterStyles;
    if (list) for (j = 0; j < list.length; j++) if (list[j].name === r) { s = list[j]; break; }
    if (!s) { failed.push(r + ': not an unused style'); continue; }
    try { s.remove(); removed.push(r); } catch (e) { failed.push(r + ': ' + e.message); }
  }
}
return { document: d.name, paragraphStyles: allP.length, characterStyles: allC.length, usedParagraph: (function () { var n = 0; for (var k in usedP) n++; return n; })(), unusedParagraph: unusedP, unusedCharacter: unusedC,
  keptBecauseDependedOn: keptP.concat(keptC), removed: removed, failed: failed };
