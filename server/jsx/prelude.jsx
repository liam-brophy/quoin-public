// Prepended to every script the MCP server sends to InDesign.
// ExtendScript is ES3: no JSON, let/const, arrow functions or Array#map.

// Built from a string: ExtendScript decodes unicode escapes for U+2028/U+2029 anywhere
// in source (regex literals, even comments) into real line breaks.
var __ESCAPE = new RegExp('[\\\\"\\x00-\\x1f\\u2028\\u2029]', 'g');

function __q(s) {
  return '"' + s.replace(__ESCAPE, function (c) {
    var m = { '\\': '\\\\', '"': '\\"', '\n': '\\n', '\r': '\\r', '\t': '\\t' };
    return m[c] || ('\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4));
  }) + '"';
}

function __json(v) {
  if (v === null || v === undefined) return 'null';
  var t = typeof v;
  if (t === 'number') return isFinite(v) ? String(v) : 'null';
  if (t === 'boolean') return String(v);
  if (t === 'string') return __q(v);
  if (v instanceof Array) {
    var a = [];
    for (var i = 0; i < v.length; i++) a.push(__json(v[i]));
    return '[' + a.join(',') + ']';
  }
  if (t === 'object') {
    // InDesign enums and DOM objects: report their name rather than walking them.
    if (v.constructor !== Object) return __q(String(v));
    var p = [];
    for (var k in v) if (v.hasOwnProperty(k)) p.push(__q(k) + ':' + __json(v[k]));
    return '{' + p.join(',') + '}';
  }
  return 'null';
}

/** The document named in ARGS.document, else the active one. */
function __doc() {
  if (ARGS.document) {
    var d = app.documents.itemByName(ARGS.document);
    if (!d.isValid) throw Error('No open document named "' + ARGS.document + '".');
    return d;
  }
  if (!app.documents.length) throw Error('No document is open in InDesign.');
  try { return app.activeDocument; } catch (e) {
    throw Error('No active document: the open documents have no window. Pass document by name (see indesign_status).');
  }
}

/** The document at ARGS.path (opened with a window if not open yet), else __doc(). */
function __docAt() {
  if (!ARGS.path) return __doc();
  var f = new File(ARGS.path);
  for (var i = 0; i < app.documents.length; i++) {
    try { if (app.documents[i].fullName.fsName === f.fsName) return app.documents[i]; } catch (e) {}
  }
  if (!f.exists) throw Error('File not found: ' + ARGS.path);
  return app.open(f, true);
}

/** A font as family + style, whether InDesign hands back a Font or a bare string. */
function __font(f) {
  if (f === null || f === undefined) return null;
  if (typeof f === 'string') return { family: f, style: null };
  try { return { family: f.fontFamily, style: f.fontStyleName, status: String(f.status) }; }
  catch (e) { return { family: String(f), style: null }; }
}

function __run(fn) {
  var sp = app.scriptPreferences;
  var units = sp.measurementUnit, interaction = sp.userInteractionLevel;
  sp.measurementUnit = MeasurementUnits.POINTS;
  sp.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;
  try {
    return __json({ ok: true, result: fn() });
  } catch (e) {
    return __json({ ok: false, error: String(e.message || e), line: e.line, number: e.number });
  } finally {
    sp.measurementUnit = units;
    sp.userInteractionLevel = interaction;
  }
}
