// Export a reflowable EPUB 3. ARGS: out. Export settings changed for this export are put back afterwards.
var d = __docAt(), ep = d.epubExportPreferences, saved = [], notes = [];
function set(obj, prop, value, label) {
  try { saved.push([obj, prop, obj[prop]]); obj[prop] = value; } catch (e) { notes.push(label + ' not set: ' + e.message); }
}
set(ep, 'version', EpubVersion.EPUB3, 'EPUB 3');
set(ep, 'footnotePlacement', EPubFootnotePlacement.FOOTNOTE_INSIDE_POPUP, 'footnotes as pop-ups');
// "Split Document" must be on for any paragraph style's split setting to take effect.
// An empty style name means: split on every style whose export tagging says so.
set(ep, 'breakDocument', true, 'split document');
set(ep, 'paragraphStyleName', '', 'split on export tags');
try { set(ep, 'epubCreatePageNavigation', true, 'print page list'); } catch (e) {}
var out = new File(ARGS.out);
if (!out.parent.exists) throw Error('Output folder does not exist: ' + out.parent.fsName);
try {
  d.exportFile(ExportFormat.EPUB, out, false);
} finally {
  for (var i = saved.length - 1; i >= 0; i--) { try { saved[i][0][saved[i][1]] = saved[i][2]; } catch (e) {} }
}
return { document: d.name, epub: out.fsName, exists: out.exists, bytes: out.exists ? out.length : 0, notes: notes };
