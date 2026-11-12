var d = __doc();
var want = ARGS.kind || 'both';
var only = ARGS.names || null; // optional list of style names
var i;

function wanted(name) {
  if (!only) return true;
  for (var k = 0; k < only.length; k++) if (only[k] === name) return true;
  return false;
}

function path(st) {
  var parts = [st.name], p = st.parent;
  while (p && (p.constructor.name === 'ParagraphStyleGroup' || p.constructor.name === 'CharacterStyleGroup')) {
    parts.unshift(p.name);
    p = p.parent;
  }
  return parts.join(' / ');
}

// [No Paragraph Style] and [None] are root styles: reading basedOn (and most
// other properties) on them throws "Invalid request on a root style".
function isRoot(st) {
  try { st.basedOn; return false; } catch (e) { return true; }
}

function leading(st) {
  return st.leading === Leading.AUTO ? { auto: true, percent: st.autoLeading } : st.leading;
}

var paragraph = [];
if (want !== 'character') {
  for (i = 0; i < d.allParagraphStyles.length; i++) {
    var p = d.allParagraphStyles[i];
    if (!wanted(p.name) || isRoot(p)) continue;
    paragraph.push({
      name: p.name,
      path: path(p),
      basedOn: p.basedOn && p.basedOn.name ? p.basedOn.name : null,
      nextStyle: p.nextStyle && p.nextStyle.name ? p.nextStyle.name : null,
      font: __font(p.appliedFont),
      fontStyle: String(p.fontStyle),
      pointSize: p.pointSize,
      leading: leading(p),
      tracking: p.tracking,
      justification: String(p.justification),
      firstLineIndent: p.firstLineIndent,
      leftIndent: p.leftIndent,
      rightIndent: p.rightIndent,
      spaceBefore: p.spaceBefore,
      spaceAfter: p.spaceAfter,
      alignToBaseline: p.alignToBaseline,
      hyphenation: p.hyphenation,
      capitalization: String(p.capitalization),
      keepWithNext: p.keepWithNext,
      dropCapLines: p.dropCapLines
    });
  }
}

var character = [];
if (want !== 'paragraph') {
  for (i = 0; i < d.allCharacterStyles.length; i++) {
    var c = d.allCharacterStyles[i];
    if (!wanted(c.name) || isRoot(c)) continue;
    character.push({
      name: c.name,
      path: path(c),
      font: c.appliedFont === NothingEnum.NOTHING ? null : __font(c.appliedFont),
      fontStyle: c.fontStyle === NothingEnum.NOTHING ? null : String(c.fontStyle),
      pointSize: c.pointSize === NothingEnum.NOTHING ? null : c.pointSize,
      capitalization: c.capitalization === NothingEnum.NOTHING ? null : String(c.capitalization),
      tracking: c.tracking === NothingEnum.NOTHING ? null : c.tracking
    });
  }
}

return { document: d.name, units: 'pt', paragraph: paragraph, character: character };
