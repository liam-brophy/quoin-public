// Build an imposed document from a PDF of single pages. ARGS: pdf, outIndd, outPdf, w, h (page), sheetW, sheetH,
// sheets: [{ label, cells: [{ page|null, x, y, rot }] }]
var d = app.documents.add(false);
var pp = app.pdfPlacePreferences, oldCrop = pp.pdfCrop, oldPage = pp.pageNumber;
var ep = app.pdfExportPreferences, oldRange = ep.pageRange, oldSpreads = ep.exportReaderSpreads;
try {
  var dp = d.documentPreferences, placed = 0, i, j;
  dp.facingPages = false; dp.pageWidth = ARGS.sheetW; dp.pageHeight = ARGS.sheetH; dp.pagesPerDocument = ARGS.sheets.length;
  d.viewPreferences.rulerOrigin = RulerOrigin.PAGE_ORIGIN;
  var none = d.swatches.itemByName('None'), pdf = new File(ARGS.pdf);
  pp.pdfCrop = PDFCrop.CROP_MEDIA;
  for (i = 0; i < ARGS.sheets.length; i++) {
    var page = d.pages[i], cells = ARGS.sheets[i].cells;
    var mp = page.marginPreferences; mp.top = 0; mp.bottom = 0; mp.left = 0; mp.right = 0;
    for (j = 0; j < cells.length; j++) {
      var c = cells[j]; if (c.page === null) continue;
      var r = page.rectangles.add({ geometricBounds: [c.y, c.x, c.y + ARGS.h, c.x + ARGS.w] });
      r.strokeWeight = 0; r.strokeColor = none; r.fillColor = none;
      pp.pageNumber = c.page;
      r.place(pdf);
      r.fit(FitOptions.CONTENT_TO_FRAME);
      if (c.rot) {
        r.absoluteRotationAngle = c.rot;
        var b = r.geometricBounds; // rotation turns about the frame's own anchor: put it back in its cell
        r.move(undefined, [c.x - b[1], c.y - b[0]]);
      }
      placed++;
    }
  }
  ep.pageRange = PageRange.ALL_PAGES; ep.exportReaderSpreads = false;
  d.exportFile(ExportFormat.PDF_TYPE, new File(ARGS.outPdf), false);
  d.save(new File(ARGS.outIndd));
  return { indd: ARGS.outIndd, pdf: ARGS.outPdf, sheetsSides: ARGS.sheets.length, pagesPlaced: placed, sheetSize: { width: ARGS.sheetW, height: ARGS.sheetH } };
} finally {
  pp.pdfCrop = oldCrop; pp.pageNumber = oldPage; ep.pageRange = oldRange; ep.exportReaderSpreads = oldSpreads;
  d.close(SaveOptions.NO);
}
