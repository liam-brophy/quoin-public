// ARGS: format ('pdf' | 'idml' | 'epub' | 'epub-fixed'), path, pdfPreset?, source? (an .indd to open, export, close)
var opened = null;
var d;
if (ARGS.source) {
  var src = new File(ARGS.source);
  if (!src.exists) throw Error('Source file not found: ' + ARGS.source);
  opened = app.open(src, false); // no window
  d = opened;
} else {
  d = __doc();
}

try {
  var out = new File(ARGS.path);
  if (!out.parent.exists) throw Error('Output folder does not exist: ' + out.parent.fsName);

  if (ARGS.format === 'pdf') {
    if (ARGS.pdfPreset) {
      var preset = app.pdfExportPresets.itemByName(ARGS.pdfPreset);
      if (!preset.isValid) {
        throw Error('No PDF preset named "' + ARGS.pdfPreset + '". Available: ' +
          app.pdfExportPresets.everyItem().name.join(', '));
      }
      d.exportFile(ExportFormat.PDF_TYPE, out, false, preset);
    } else {
      d.exportFile(ExportFormat.PDF_TYPE, out, false);
    }
  } else if (ARGS.format === 'idml') {
    d.exportFile(ExportFormat.INDESIGN_MARKUP, out, false);
  } else if (ARGS.format === 'epub') {
    d.exportFile(ExportFormat.EPUB, out, false);
  } else if (ARGS.format === 'epub-fixed') {
    d.exportFile(ExportFormat.FIXED_LAYOUT_EPUB, out, false);
  } else {
    throw Error('Unknown format: ' + ARGS.format);
  }
  return { document: d.name, format: ARGS.format, path: out.fsName, exists: out.exists };
} finally {
  if (opened) opened.close(SaveOptions.NO);
}
