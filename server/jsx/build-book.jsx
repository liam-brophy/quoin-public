// Flow a book's ICML stories into a copy of the template.
// ARGS: indd (the copy, saved in place), master, icmls: [{ path, title, start: 'recto'|'verso'|'any' }],
//       missingParagraph: [{ name, basedOn }], missingCharacter: [name]
var d = app.open(new File(ARGS.indd), false);
var log = { createdParagraph: 0, createdCharacter: 0, topics: [], warnings: [] };

/** A text frame filling the page's margins. */
function marginFrame(page) {
  var b = page.bounds, mp = page.marginPreferences;
  // Facing pages: marginPreferences.left is the inside margin, which sits on the right of a verso.
  var verso = page.side === PageSideOptions.LEFT_HAND;
  return page.textFrames.add({
    geometricBounds: [b[0] + mp.top, b[1] + (verso ? mp.right : mp.left), b[2] - mp.bottom, b[3] - (verso ? mp.left : mp.right)],
    textFramePreferences: { textColumnCount: mp.columnCount, textColumnGutter: mp.columnGutter }
  });
}

function findStyle(collection, name) {
  for (var i = 0; i < collection.length; i++) if (collection[i].name === name) return collection[i];
  return null;
}

// A different trim or margins than the template's (ARGS.page, points). Master-page items stay where they were.
if (ARGS.page) {
  var pgs = ARGS.page, dpp = d.documentPreferences;
  if (pgs.width) { dpp.pageWidth = pgs.width; dpp.pageHeight = pgs.height; }
  if (pgs.margins) {
    var setMargins = function (mp) { mp.top = pgs.margins.top; mp.bottom = pgs.margins.bottom; mp.left = pgs.margins.inside; mp.right = pgs.margins.outside; };
    setMargins(d.marginPreferences);
    for (var msi = 0; msi < d.masterSpreads.length; msi++) for (var mpi = 0; mpi < d.masterSpreads[msi].pages.length; mpi++) setMargins(d.masterSpreads[msi].pages[mpi].marginPreferences);
    for (var dpi = 0; dpi < d.pages.length; dpi++) setMargins(d.pages[dpi].marginPreferences);
  }
  log.warnings.push('Trim or margins differ from the template: running heads and folios on the master pages were not moved. Check the masters.');
}

// Place points are spread coordinates only with the spread ruler origin; book
// templates usually use page origin, which would drop a recto onto its verso.
var vp = d.viewPreferences, rulerOrigin = vp.rulerOrigin;
vp.rulerOrigin = RulerOrigin.SPREAD_ORIGIN;
log.templateRulerOrigin = String(rulerOrigin);

try {
  // 1. Styles the template lacks, based on their nearest relative so text arrives looking sane.
  var allP = d.allParagraphStyles;
  for (var i = 0; i < ARGS.missingParagraph.length; i++) {
    var m = ARGS.missingParagraph[i];
    if (findStyle(allP, m.name)) continue;
    var parent = findStyle(allP, m.basedOn) || d.paragraphStyles.itemByName('[Basic Paragraph]');
    d.paragraphStyles.add({ name: m.name, basedOn: parent });
    log.createdParagraph++;
  }
  var allC = d.allCharacterStyles;
  for (i = 0; i < ARGS.missingCharacter.length; i++) {
    if (!findStyle(allC, ARGS.missingCharacter[i])) { d.characterStyles.add({ name: ARGS.missingCharacter[i] }); log.createdCharacter++; }
  }

  // Fonts the house never uses (Times …) move to the body face in this copy; the template is untouched.
  log.fontsReplaced = [];
  if (ARGS.fonts && ARGS.fonts.replace && ARGS.fonts['with']) {
    var bad = {}; for (var fi = 0; fi < ARGS.fonts.replace.length; fi++) bad[ARGS.fonts.replace[fi]] = true;
    var face = ARGS.fonts['with'];
    var fix = function (st, kind) {
      var f = st.appliedFont, fam = null, sty = null;
      try { if (typeof f === 'string') fam = f.split('\t')[0]; else { fam = f.fontFamily; sty = f.fontStyleName; } } catch (e) { return; }
      if (!fam || !bad[fam]) return;
      var want = String(st.fontStyle || sty || 'Regular');
      if (want === 'Roman' || want === 'Book') want = 'Regular';
      var target = app.fonts.itemByName(face + '\t' + want);
      if (!target.isValid) { target = app.fonts.itemByName(face + '\tRegular'); want = 'Regular'; }
      if (!target.isValid) { log.warnings.push('Body face "' + face + '" is not installed; ' + st.name + ' stays in ' + fam + '.'); return; }
      st.appliedFont = face; st.fontStyle = want;
      log.fontsReplaced.push(kind + ' ' + st.name + ': ' + fam + ' → ' + face + ' ' + want);
    };
    for (var pi2 = 0; pi2 < d.allParagraphStyles.length; pi2++) { var ps = d.allParagraphStyles[pi2]; if (!/^\[No/.test(ps.name)) try { fix(ps, 'paragraph'); } catch (e) {} }
    for (var ci2 = 0; ci2 < d.allCharacterStyles.length; ci2++) { var cs = d.allCharacterStyles[ci2]; if (cs.name !== '[None]') try { fix(cs, 'character'); } catch (e) {} }
  }

  var master = d.masterSpreads.itemByName(ARGS.master);
  if (!master.isValid) { log.warnings.push('Master "' + ARGS.master + '" not found; pages keep the template master.'); master = null; }

  // 2. Each topic starts on a fresh page (recto/verso as asked) and autoflows.
  for (i = 0; i < ARGS.icmls.length; i++) {
    var item = ARGS.icmls[i];
    var page;
    if (i === 0) {
      page = d.pages[0];
    } else {
      page = d.pages.add(LocationOptions.AT_END);
      var right = page.side === PageSideOptions.RIGHT_HAND;
      if ((item.start === 'recto' && !right) || (item.start === 'verso' && right)) {
        page = d.pages.add(LocationOptions.AT_END);
      }
    }
    if (master) page.appliedMaster = master;

    // Explicit frames, not place-point autoflow: autoflow picks its own page
    // from the point and dropped every recto topic onto the verso before it.
    var startPage = page.name;
    var frame = marginFrame(page);
    frame.place(new File(item.path));
    var story = frame.parentStory;
    var guard = 0;
    while (frame.overflows && guard++ < 5000) {
      var next = d.pages.add(LocationOptions.AT_END);
      if (master) next.appliedMaster = master;
      var nf = marginFrame(next);
      nf.previousTextFrame = frame;
      frame = nf;
      story.recompose();
    }
    var endFrame = frame;
    log.topics.push({
      title: item.title,
      file: item.path.replace(/^.*\//, ''),
      startPage: startPage,
      endPage: endFrame.parentPage ? endFrame.parentPage.name : null,
      frames: story.textContainers.length,
      overset: story.overflows
    });
  }

  if (master) d.pages.everyItem().appliedMaster = master;
  vp.rulerOrigin = rulerOrigin;
  d.save(new File(ARGS.indd));
  log.pages = d.pages.length;
  var over = 0;
  for (i = 0; i < d.stories.length; i++) if (d.stories[i].overflows) over++;
  log.oversetStories = over;
  return log;
} finally {
  d.close(SaveOptions.NO);
}
