// Read every art note ("ART: …") in the document, with where it sits and the space around it.
var d = __docAt(), out = [], i, k;
for (i = 0; i < d.stories.length; i++) {
  var st = d.stories[i], notes = st.notes;
  for (k = 0; k < notes.length; k++) {
    var n = notes[k], text = String(n.texts[0].contents);
    if (text.indexOf('ART:') !== 0) continue;
    var ip = n.storyOffset, tf = null, page = null;
    try { tf = ip.parentTextFrames[0]; page = tf.parentPage; } catch (e) {}
    var info = { story: st.id, note: k, text: text, page: page ? page.name : null, overset: !tf };
    if (tf) {
      var b = tf.geometricBounds, cols = tf.textFramePreferences.textColumnCount, gut = tf.textFramePreferences.textColumnGutter;
      var inset = tf.textFramePreferences.insetSpacing, w = b[3] - b[1] - inset[1] - inset[3];
      info.columnWidth = (w - (cols - 1) * gut) / cols;
      info.frameHeight = b[2] - b[0] - inset[0] - inset[2];
      info.topic = (function () { try { var ps = ip.paragraphs[0].appliedParagraphStyle.name; var m = /^([a-z0-9]+)_/.exec(ps); return m ? m[1] : null; } catch (e) { return null; } })();
    }
    out.push(info);
  }
}
return { document: d.name, notes: out };
