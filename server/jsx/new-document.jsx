// A new document from specs. ARGS (points): out, width, height, pages, facing, margins{top,bottom,inside,outside},
// columns, gutter, bleed, baseline{start,increment}, styles[{name, font, fontStyle, size, leading, align, firstLineIndent, spaceBefore, spaceAfter, basedOn}]
var d = app.documents.add(false), log = { styles: [], warnings: [] };
try {
  var dp = d.documentPreferences, i;
  dp.facingPages = ARGS.facing !== false;
  dp.pageWidth = ARGS.width; dp.pageHeight = ARGS.height;
  dp.pagesPerDocument = ARGS.pages || 1;
  if (ARGS.bleed) { dp.documentBleedUniformSize = true; dp.documentBleedTopOffset = ARGS.bleed; }
  var m = ARGS.margins || { top: 36, bottom: 36, inside: 36, outside: 36 };
  var setM = function (mp) { mp.top = m.top; mp.bottom = m.bottom; mp.left = m.inside; mp.right = m.outside; mp.columnCount = ARGS.columns || 1; if (ARGS.gutter) mp.columnGutter = ARGS.gutter; };
  setM(d.marginPreferences);
  for (i = 0; i < d.masterSpreads.length; i++) for (var j = 0; j < d.masterSpreads[i].pages.length; j++) setM(d.masterSpreads[i].pages[j].marginPreferences);
  for (i = 0; i < d.pages.length; i++) setM(d.pages[i].marginPreferences);
  if (ARGS.baseline) { d.gridPreferences.baselineStart = ARGS.baseline.start; d.gridPreferences.baselineDivision = ARGS.baseline.increment; }
  var ALIGN = { left: Justification.LEFT_ALIGN, center: Justification.CENTER_ALIGN, right: Justification.RIGHT_ALIGN, justify: Justification.LEFT_JUSTIFIED };
  var list = ARGS.styles || [];
  // The font list as plain names: even asking InDesign whether a missing font is valid raises the error.
  var have = {}, fontNames = list.length ? app.fonts.everyItem().name : [];
  for (i = 0; i < fontNames.length; i++) have[String(fontNames[i])] = true;
  for (i = 0; i < list.length; i++) {
    var s = list[i], st = d.paragraphStyles.add({ name: s.name });
    try {
      if (s.basedOn) { var b = d.paragraphStyles.itemByName(s.basedOn); if (b.isValid) st.basedOn = b; }
      // Check first: a failed font assignment makes InDesign roll back everything this script has done so far.
      if (s.font) {
        var fs = s.fontStyle || 'Regular';
        if (have[s.font + '\t' + fs]) { st.appliedFont = s.font; st.fontStyle = fs; }
        else log.warnings.push(s.name + ': "' + s.font + ' ' + fs + '" is not available (see design_fonts); the style keeps the default font.');
      }
      if (s.size) st.pointSize = s.size;
      if (s.leading) st.leading = s.leading;
      if (s.align) st.justification = ALIGN[s.align];
      if (s.firstLineIndent !== undefined) st.firstLineIndent = s.firstLineIndent;
      if (s.spaceBefore !== undefined) st.spaceBefore = s.spaceBefore;
      if (s.spaceAfter !== undefined) st.spaceAfter = s.spaceAfter;
      if (ARGS.baseline && s.alignToBaseline) st.alignToBaseline = true;
      log.styles.push(s.name);
    } catch (e) { log.warnings.push(s.name + ': ' + e.message + ' (is "' + s.font + ' ' + (s.fontStyle || 'Regular') + '" available? see design_fonts)'); }
  }
  d.save(new File(ARGS.out));
  return { document: ARGS.out, pages: d.pages.length, pageSize: { width: ARGS.width, height: ARGS.height }, facing: dp.facingPages, styles: log.styles, warnings: log.warnings };
} finally { d.close(SaveOptions.NO); }
