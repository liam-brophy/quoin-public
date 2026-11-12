// Export each story's opening heading lines, as styled in the layout, to a PNG.
// ARGS: path, outDir, styles (base style names that count as opener lines), resolution, transparent
var d = __docAt(), out = {}, skipped = [], i;
var VARIANT = /_(first|middle|last|only|start|end|single|aft|aftsep)$/;
function base(name) {
  var m = /^([a-z0-9]+)_(.+)$/.exec(name); if (!m) return name;
  var b = m[2]; while (VARIANT.test(b)) b = b.replace(VARIANT, '');
  return b;
}
var want = {}; for (i = 0; i < ARGS.styles.length; i++) want[ARGS.styles[i]] = true;
var png = app.pngExportPreferences, old = { r: png.exportResolution, t: png.transparentBackground, q: png.pngQuality };
png.exportResolution = ARGS.resolution || 220; png.transparentBackground = ARGS.transparent !== false; png.pngQuality = PNGQualityEnum.HIGH;
try { png.antiAlias = true; } catch (e) {}
var page = d.pages[0];
try {
  for (i = 0; i < d.stories.length; i++) {
    var st = d.stories[i], link = null;
    try { if (st.itemLink && st.itemLink.isValid) link = st.itemLink.name; } catch (e) {}
    if (!link || !st.textContainers.length || !st.paragraphs.length) continue;
    var key = link.replace(/\.icml$/i, ''), n = 0, styles = st.paragraphs.everyItem().appliedParagraphStyle;
    while (n < styles.length && n < 8 && want[base(styles[n].name)]) n++;
    if (!n) continue;
    if (n === styles.length) { skipped.push(key + ': nothing but heading lines (a title page?)'); continue; }
    var tc = st.textContainers[0], b = tc.geometricBounds, w = b[3] - b[1];
    var tmp = page.textFrames.add({ geometricBounds: [0, -w - 200, 400, -200] });
    try {
      st.paragraphs.itemByRange(0, n - 1).duplicate(LocationOptions.AT_BEGINNING, tmp.insertionPoints[0]);
      var ts = tmp.parentStory;
      while (ts.characters.length && ts.characters[-1].contents === '\r') ts.characters[-1].remove();
      tmp.textFramePreferences.insetSpacing = [3, 0, 3, 0]; // room for ascenders and descenders at the edges
      tmp.textFramePreferences.autoSizingReferencePoint = AutoSizingReferenceEnum.TOP_CENTER_POINT;
      tmp.textFramePreferences.autoSizingType = AutoSizingTypeEnum.HEIGHT_ONLY;
      var gb = tmp.geometricBounds, file = new File(ARGS.outDir + '/' + key + '.png');
      tmp.exportFile(ExportFormat.PNG_FORMAT, file);
      out[key] = { image: key + '.png', paragraphs: n, widthPt: Math.round(gb[3] - gb[1]), heightPt: Math.round(gb[2] - gb[0]), text: String(ts.contents).replace(/\r/g, ' / ').substr(0, 80) };
    } finally { tmp.remove(); }
  }
} finally { png.exportResolution = old.r; png.transparentBackground = old.t; png.pngQuality = old.q; }
return { document: d.name, openers: out, skipped: skipped };
