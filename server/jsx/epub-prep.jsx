// EPUB readiness. ARGS: rules (profile epub section), meta { title, author, publisher, isbn, language }, apply (false = dry run).
var d = __docAt(), R = ARGS.rules || {}, M = ARGS.meta || {}, plan = [], done = [], failed = [], i, j;
var VARIANT = /_(first|middle|last|only|start|end|single|aft|aftsep)$/;
function base(name) {
  var m = /^([a-z0-9]+)_(.+)$/.exec(name); if (!m) return { topic: null, base: name };
  var parts = m[2].split('_');
  while (parts.length > 1 && /-[is]$/.test(parts[0])) parts.shift();      // container prefix (electr-i_)
  var b = parts.join('_'); while (VARIANT.test(b)) b = b.replace(VARIANT, '');
  return { topic: m[1], base: b.split('_')[0] };
}
function inList(list, x) { if (!list) return false; for (var k = 0; k < list.length; k++) if (list[k] === x) return true; return false; }
function epubMap(st) {
  var maps = st.styleExportTagMaps;
  for (var k = 0; k < maps.length; k++) if (maps[k].exportType === 'EPUB' || maps[k].exportType === 'All') return maps[k];
  return null;
}
var ps = d.allParagraphStyles;
for (i = 0; i < ps.length; i++) {
  var st = ps[i]; if (/^\[/.test(st.name)) continue;
  var b = base(st.name), tag = (R.headings || {})[b.base] || (inList(R.blockquote, b.base) ? 'blockquote' : null);
  if (tag) {
    var cur = epubMap(st), curTag = cur ? cur.exportTag : '(automatic)';
    if (curTag !== tag) {
      plan.push({ style: st.name, change: 'export tag', from: curTag, to: tag });
      if (ARGS.apply) {
        try {
          if (cur) cur.exportTag = tag;
          else st.styleExportTagMaps.add({ exportType: 'EPUB', exportTag: tag, exportClass: '', exportAttributes: '' });
          done.push(st.name + ' → ' + tag);
        } catch (e) { failed.push(st.name + ' tag: ' + e.message); }
      }
    }
  }
  if (inList(R.split, b.base) && inList(R.splitTopics, b.topic)) {
    var was = null; try { was = st.splitDocument; } catch (e) {}
    if (was !== true) {
      plan.push({ style: st.name, change: 'starts a new EPUB file', from: String(was), to: 'true' });
      if (ARGS.apply) { try { st.splitDocument = true; done.push(st.name + ' splits'); } catch (e) { failed.push(st.name + ' split: ' + e.message); } }
    }
  }
}
var langs = R.languages || {};
for (var cname in langs) {
  var cs = d.characterStyles.itemByName(cname); if (!cs.isValid) continue;
  var curL = ''; try { curL = cs.appliedLanguage === NothingEnum.NOTHING ? '(none)' : cs.appliedLanguage.name; } catch (e) { curL = '(none)'; }
  if (curL !== langs[cname]) {
    plan.push({ style: cname, change: 'language', from: curL, to: langs[cname] });
    if (ARGS.apply) { try { cs.appliedLanguage = langs[cname]; done.push(cname + ' → ' + langs[cname]); } catch (e) { failed.push(cname + ' language "' + langs[cname] + '": ' + e.message); } }
  }
}
// Metadata the EPUB carries (title, creator, publisher, identifier).
var mp = d.metadataPreferences, ep = d.epubExportPreferences;
var metaPlan = [['document title', mp, 'documentTitle', M.title], ['author', mp, 'author', M.author], ['EPUB title', ep, 'epubTitle', M.title],
  ['EPUB creator', ep, 'epubCreator', M.author], ['EPUB publisher', ep, 'epubPublisher', M.publisher], ['EPUB identifier', ep, 'id', M.isbn ? 'urn:isbn:' + M.isbn.replace(/[^0-9Xx]/g, '') : null]];
for (i = 0; i < metaPlan.length; i++) {
  var mm = metaPlan[i]; if (!mm[3]) continue;
  var have = null; try { have = mm[1][mm[2]]; } catch (e) { failed.push(mm[0] + ': not settable in this InDesign (' + e.message + ')'); continue; }
  if (have !== mm[3]) {
    plan.push({ style: '(document)', change: mm[0], from: String(have), to: mm[3] });
    if (ARGS.apply) { try { mm[1][mm[2]] = mm[3]; done.push(mm[0]); } catch (e) { failed.push(mm[0] + ': ' + e.message); } }
  }
}
// What the reader can't fix by setting styles: unlanguaged lang runs, placed images without alt text.
var notes = [];
try { if (d.characterStyles.itemByName('lang').isValid) notes.push('The generic "lang" style has no single language: set the language of those runs by hand (e.g. Hindi).'); } catch (e) {}
var imgs = 0, noAlt = 0;
for (i = 0; i < d.allGraphics.length; i++) {
  imgs++;
  try { var fr = d.allGraphics[i].parent, o = fr.objectExportOptions; if (o.altTextSourceType === SourceType.SOURCE_CUSTOM && !o.customAltText) noAlt++; else if (o.altTextSourceType !== SourceType.SOURCE_CUSTOM) noAlt++; } catch (e) {}
}
if (imgs) notes.push(imgs + ' placed graphics; ' + noAlt + ' without custom alt text (Object Export Options).');
return { document: d.name, applied: !!ARGS.apply, changes: plan.length, plan: plan.slice(0, 200), done: done.length, failed: failed, notes: notes };
