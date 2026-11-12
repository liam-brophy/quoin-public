// File › Package, without saving or changing the document. ARGS: path, out (folder), fonts, links, idml, pdf, pdfPreset, comments.
var d = __docAt();
if (!d.saved) throw Error('The document has never been saved. Save it in InDesign first: Quoin does not save your documents.');
if (d.modified) throw Error('The document has unsaved changes. Save it in InDesign first (Quoin does not save your documents), then package again.');
if (ARGS.pdf && ARGS.pdfPreset && !app.pdfExportPresets.itemByName(ARGS.pdfPreset).isValid)
  throw Error('No PDF preset "' + ARGS.pdfPreset + '". Have: ' + app.pdfExportPresets.everyItem().name.join(', '));
var folder = new Folder(ARGS.out);
if (folder.exists && folder.getFiles().length) throw Error('The package folder is not empty: ' + folder.fsName + '. Choose a new folder.');
if (!folder.exists && !folder.create()) throw Error('Could not create ' + ARGS.out);
// Package works on the active document (a long-standing InDesign bug ignores the one it is called on).
app.activeDocument = d;
var ok = d.packageForPrint(
  folder,
  ARGS.fonts !== false,          // copyingFonts
  ARGS.links !== false,          // copyingLinkedGraphics
  true,                          // copyingProfiles
  true,                          // updatingGraphics (links in the packaged copy point into Links/)
  true,                          // includingHiddenLayers
  true,                          // ignorePreflightErrors (Quoin reports preflight separately)
  true,                          // creatingReport (Instructions.txt)
  ARGS.idml !== false,           // includeIdml
  false,                         // includePdf: exported below from the packaged copy, as Package's own PDF marks the original as changed
  ARGS.pdfPreset || '[High Quality Print]',
  false,                         // useDocumentHyphenationExceptionsOnly
  ARGS.comments || '',           // versionComments
  false                          // forceSave: never save the designer's document
);
var pdf = null;
if (ARGS.pdf && ok !== false) {
  var copy = new File(folder.fsName + '/' + d.name);
  if (!copy.exists) throw Error('Packaged, but the packaged copy was not found for the PDF: ' + copy.fsName);
  var c = app.open(copy, false);
  try {
    pdf = new File(folder.fsName + '/' + d.name.replace(/\.indd$/i, '') + '.pdf');
    c.exportFile(ExportFormat.PDF_TYPE, pdf, false, app.pdfExportPresets.itemByName(ARGS.pdfPreset || '[High Quality Print]'));
  } finally { c.close(SaveOptions.NO); }
  pdf = pdf.exists ? pdf.fsName : null;
}
var listing = [];
(function walk(f, prefix, depth) {
  var items = f.getFiles();
  for (var i = 0; i < items.length; i++) {
    var it = items[i], n = prefix + decodeURI(it.name);
    if (it instanceof Folder) { listing.push(n + '/ (' + it.getFiles().length + ')'); if (depth < 1) walk(it, n + '/', depth + 1); }
    else listing.push(n);
  }
})(folder, '', 0);
return { packaged: ok !== false, folder: folder.fsName, pdf: pdf, contents: listing, documentUnchanged: !d.modified };
