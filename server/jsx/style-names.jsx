// ARGS: path (an .indd to read; opened without a window and closed unsaved)
var d = app.open(new File(ARGS.path), false);
try {
  var p = [], c = [], i;
  var ps = d.allParagraphStyles, cs = d.allCharacterStyles;
  for (i = 0; i < ps.length; i++) p.push(ps[i].name);
  for (i = 0; i < cs.length; i++) c.push(cs[i].name);
  var masters = [];
  for (i = 0; i < d.masterSpreads.length; i++) masters.push(d.masterSpreads[i].name);
  return { paragraph: p, character: c, masters: masters };
} finally {
  d.close(SaveOptions.NO);
}
