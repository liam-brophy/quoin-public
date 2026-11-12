// Documents opened without a window are never the active one; activeDocument then throws.
var activeId = null;
try { if (app.documents.length) activeId = app.activeDocument.id; } catch (e) {}
var docs = [];
for (var i = 0; i < app.documents.length; i++) {
  var d = app.documents[i];
  docs.push({
    name: d.name,
    path: d.saved ? d.fullName.fsName : null,
    modified: d.modified,
    pages: d.pages.length,
    windows: d.windows.length,
    active: d.id === activeId
  });
}
return { app: app.name, version: app.version, documents: docs };
