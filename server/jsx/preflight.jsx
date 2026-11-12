// InDesign preflight, summarised by rule. ARGS: profile (name; default = the document's working profile).
var d = __docAt(), prof = null, i;
if (ARGS.profile) { prof = app.preflightProfiles.itemByName(ARGS.profile); if (!prof.isValid) throw Error('No preflight profile "' + ARGS.profile + '". Have: ' + app.preflightProfiles.everyItem().name.join(', ')); }
else { try { var w = d.preflightOptions.preflightWorkingProfile; prof = typeof w === 'string' ? app.preflightProfiles.itemByName(w) : w; } catch (e) {} }
if (!prof || !prof.isValid) prof = app.preflightProfiles[0];
var proc = app.preflightProcesses.add(d, prof);
try {
  proc.waitForProcess();
  var res = proc.aggregatedResults, entries = res && res[2] ? res[2] : [], byRule = {}, samples = {};
  // Each entry: [index, rule name, item description, page, ...]
  for (i = 0; i < entries.length; i++) {
    var e = entries[i], rule = String(e[1]);
    byRule[rule] = (byRule[rule] || 0) + 1;
    if (!samples[rule]) samples[rule] = [];
    if (samples[rule].length < 3) samples[rule].push(String(e[2]).substr(0, 80) + (e[3] ? ' (page ' + e[3] + ')' : ''));
  }
  return { document: d.name, profile: prof.name, problems: entries.length, byRule: byRule, samples: samples };
} finally { try { proc.remove(); } catch (e) {} }
