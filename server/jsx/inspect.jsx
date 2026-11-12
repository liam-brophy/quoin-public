var d = __doc();
var dp = d.documentPreferences, gp = d.gridPreferences;
var mp = d.pages[0].marginPreferences;
var i;

var masters = [];
for (i = 0; i < d.masterSpreads.length; i++) {
  var ms = d.masterSpreads[i];
  masters.push({ name: ms.name, pages: ms.pages.length, basedOn: ms.appliedMaster ? ms.appliedMaster.name : null });
}

var overset = [];
for (i = 0; i < d.stories.length; i++) {
  var s = d.stories[i];
  if (s.overflows) overset.push({ id: s.id, words: s.words.length, starts: s.contents.substr(0, 80) });
}

var fonts = [];
for (i = 0; i < d.fonts.length; i++) {
  var f = d.fonts[i];
  if (f.status !== FontStatus.INSTALLED) fonts.push({ name: f.name.replace('\t', ' '), status: String(f.status) });
}

var links = [];
for (i = 0; i < d.links.length; i++) {
  var l = d.links[i];
  if (l.status !== LinkStatus.NORMAL) links.push({ name: l.name, status: String(l.status) });
}

return {
  name: d.name,
  path: d.saved ? d.fullName.fsName : null,
  pages: d.pages.length,
  facingPages: dp.facingPages,
  units: 'pt',
  pageSize: { width: dp.pageWidth, height: dp.pageHeight },
  bleed: {
    top: dp.documentBleedTopOffset, bottom: dp.documentBleedBottomOffset,
    inside: dp.documentBleedInsideOrLeftOffset, outside: dp.documentBleedOutsideOrRightOffset
  },
  // On facing pages InDesign's left/right margins mean inside/outside.
  margins: { top: mp.top, bottom: mp.bottom, inside: mp.left, outside: mp.right },
  columns: { count: mp.columnCount, gutter: mp.columnGutter },
  baselineGrid: { start: gp.baselineStart, increment: gp.baselineDivision },
  masters: masters,
  styleCounts: {
    paragraph: d.allParagraphStyles.length,
    character: d.allCharacterStyles.length,
    object: d.allObjectStyles.length
  },
  stories: d.stories.length,
  oversetStories: overset,
  problemFonts: fonts,
  problemLinks: links
};
