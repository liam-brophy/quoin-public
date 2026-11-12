// Pages to the next signature. ARGS: signature (16), add (pages to add at the end; 0 = report only), master.
var d = __docAt(), sig = ARGS.signature || 16, pages = d.pages;
function blank(pg) {
  var items = pg.allPageItems;
  for (var k = 0; k < items.length; k++) {
    var it = items[k];
    try { if (it.constructor.name === 'TextFrame' && it.contents !== '') return false; } catch (e) {}
    if (it.constructor.name !== 'TextFrame') return false;
  }
  return true;
}
var trailing = 0;
for (var i = pages.length - 1; i >= 0 && blank(pages[i]); i--) trailing++;
var blanks = [];
for (i = 0; i < pages.length; i++) if (blank(pages[i])) blanks.push(pages[i].name);
var count = pages.length, needed = (sig - count % sig) % sig;
var added = 0;
if (ARGS.add) {
  var m = ARGS.master ? d.masterSpreads.itemByName(ARGS.master) : null;
  if (ARGS.master && !m.isValid) throw Error('No master named "' + ARGS.master + '".');
  for (i = 0; i < ARGS.add; i++) { var pg = d.pages.add(LocationOptions.AT_END); if (m) pg.appliedMaster = m; added++; }
}
return { document: d.name, pages: count, signature: sig, signatures: Math.ceil(count / sig), pagesToNextSignature: needed,
  pagesOverPreviousSignature: count % sig, trailingBlankPages: trailing, blankPages: blanks.slice(0, 40), added: added, pagesNow: d.pages.length };
