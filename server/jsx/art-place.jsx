// Place art at its notes. ARGS: items [{ story, note, id, page, file|null, width, height, mode: 'above'|'wrap', caption, alt, captionStyles[] }], gap
var d = __docAt(), log = { placed: [], missing: [], checkedOut: [], warnings: [], createdStyles: [] }, gap = ARGS.gap || 9;
var none = d.swatches.itemByName('None');
// The template has no caption style: make one under the house name (based on body text, left, no indent,
// a little smaller) so captions don't fall back to justified defaults. Listed for the designer to style.
function captionStyle(name) {
  var body = styleNamed([name.replace(/_cap$/, '_p'), 'chap_p', '[Basic Paragraph]']);
  var st = d.paragraphStyles.add({ name: name });
  if (body) st.basedOn = body;
  st.justification = Justification.LEFT_ALIGN; st.firstLineIndent = 0; st.spaceBefore = 0; st.spaceAfter = 0;
  try { st.pointSize = Math.max(7, Math.round((body ? body.pointSize : 12) * 0.8)); st.leading = Math.round(st.pointSize * 1.25); } catch (e) {}
  log.createdStyles.push(name);
  return st;
}
function styleNamed(names) { for (var i = 0; i < names.length; i++) { var all = d.allParagraphStyles; for (var j = 0; j < all.length; j++) if (all[j].name === names[i]) return all[j]; } return null; }
for (var i = 0; i < ARGS.items.length; i++) {
  var it = ARGS.items[i], st = d.stories.itemByID(it.story);
  if (!st.isValid) { log.warnings.push(it.id + ': story not found'); continue; }
  if (st.lockState === LockStateValues.CHECKED_IN_STORY) { st.checkOut(); log.checkedOut.push(it.id); }
  var n = st.notes[it.note], ip = n.storyOffset, page = ip.parentTextFrames[0].parentPage;
  var rect = page.rectangles.add({ geometricBounds: [0, 0, it.height, it.width] });
  rect.strokeWeight = 0; rect.strokeColor = none;
  if (it.file) {
    rect.place(new File(it.file));
    rect.fit(FitOptions.PROPORTIONALLY); rect.fit(FitOptions.CENTER_CONTENT);
  } else {
    rect.fillColor = d.swatches.itemByName('Black'); rect.fillTint = 12;
    log.missing.push(it.id);
  }
  rect.label = 'ART:' + it.id;
  if (it.alt) { rect.objectExportOptions.altTextSourceType = SourceType.SOURCE_CUSTOM; rect.objectExportOptions.customAltText = it.alt; }
  var obj = rect;
  if (it.caption) {
    var cap = page.textFrames.add({ geometricBounds: [it.height + gap / 2, 0, it.height + gap / 2 + 24, it.width], contents: it.caption });
    var cs = styleNamed(it.captionStyles || []);
    if (!cs) cs = captionStyle(it.captionStyles[0]);
    cap.paragraphs.everyItem().appliedParagraphStyle = cs;
    cap.textFramePreferences.autoSizingReferencePoint = AutoSizingReferenceEnum.TOP_CENTER_POINT;
    cap.textFramePreferences.autoSizingType = AutoSizingTypeEnum.HEIGHT_ONLY;
    obj = page.groups.add([rect, cap]);
    obj.label = 'ART:' + it.id;
  }
  var a = obj.anchoredObjectSettings;
  if (it.mode === 'wrap') {
    a.insertAnchoredObject(ip, AnchorPosition.ANCHORED);
    a = obj.anchoredObjectSettings;
    a.anchorPoint = AnchorPoint.TOP_RIGHT_ANCHOR;
    a.horizontalReferencePoint = AnchoredRelativeTo.COLUMN_EDGE;
    a.horizontalAlignment = HorizontalAlignment.RIGHT_ALIGN;
    a.anchorXoffset = 0;
    a.verticalReferencePoint = VerticallyRelativeTo.LINE_BASELINE;
    a.anchorYoffset = 0;
    try { a.pinPosition = true; } catch (e) {}
    obj.textWrapPreferences.textWrapMode = TextWrapModes.BOUNDING_BOX_TEXT_WRAP;
    obj.textWrapPreferences.textWrapOffset = [gap / 2, gap, gap, 0];
  } else {
    a.insertAnchoredObject(ip, AnchorPosition.ABOVE_LINE);
    a = obj.anchoredObjectSettings;
    a.horizontalAlignment = HorizontalAlignment.CENTER_ALIGN;
    try { a.anchorSpaceAbove = gap; } catch (e) {}
  }
  var ppi = null;
  try { if (rect.graphics.length) ppi = rect.graphics[0].effectivePpi; } catch (e) {}
  // Mark the note so a second run skips it.
  n.texts[0].insertionPoints[-1].contents = '\rplaced: ' + (it.file ? it.file.replace(/^.*\//, '') : 'placeholder (file missing)');
  log.placed.push({ id: it.id, obj: obj, story: st, mode: it.mode, plannedPage: it.page, effectivePpi: ppi ? [Math.round(ppi[0]), Math.round(ppi[1])] : null });
}
// Pages are only known once the text has reflowed around the new frames.
for (i = 0; i < log.placed.length; i++) {
  var e = log.placed[i];
  try { e.story.recompose(); } catch (x) {}
  var pg = null; try { pg = e.obj.parentPage ? e.obj.parentPage.name : null; } catch (x) {}
  e.page = pg;
  // Art set above the line that didn't fit jumps to the next page, leaving the text before it short of the page end.
  if (e.mode === 'above' && pg) {
    try {
      var at = e.obj.parent.index, prev = e.story.characters[at - 1].parentTextFrames[0].parentPage.name;
      if (prev !== pg) e.gap = 'did not fit after the text on page ' + prev + ', so it moved to page ' + pg + ': page ' + prev + ' ends short';
    } catch (x) {}
  }
  delete e.obj; delete e.story; delete e.plannedPage;
}
return log;
