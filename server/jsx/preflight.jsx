// InDesign preflight, summarised by rule. ARGS: profile (name; default = the document's working profile).
var d = __docAt(), prof = null, i;
if (ARGS.profile) { prof = app.preflightProfiles.itemByName(ARGS.profile); if (!prof.isValid) throw Error('No preflight profile "' + ARGS.profile + '". Have: ' + app.preflightProfiles.everyItem().name.join(', ')); }
else { try { var w = d.preflightOptions.preflightWorkingProfile; prof = typeof w === 'string' ? app.preflightProfiles.itemByName(w) : w; } catch (e) {} }
if (!prof || !prof.isValid) prof = app.preflightProfiles[0];
var proc = app.preflightProcesses.add(d, prof);
try {
  proc.waitForProcess();
  var res = proc.aggregatedResults, entries = res && res[2] ? res[2] : [], byRule = {}, samples = {}, problems = 0, rule = 'Other';
  // A flattened tree: category rows ("TEXT (1)"), rule rows ("Overset text (1)"), then one row per problem
  // item: [index, item, page, description, ...]. Only item rows (with a description) are problems.
  for (i = 0; i < entries.length; i++) {
    var e = entries[i], name = String(e[1]), desc = String(e[3] || '');
    if (!desc) {
      var m = /^(.*?)\s*\(\d+\)$/.exec(name);
      if (m && m[1] !== m[1].toUpperCase()) rule = m[1];
      continue;
    }
    problems++;
    byRule[rule] = (byRule[rule] || 0) + 1;
    if (!samples[rule]) samples[rule] = [];
    if (samples[rule].length < 3) samples[rule].push(name + ': ' + desc.split('\n')[0].replace(/^Problem:\s*/, '').substr(0, 80) + (e[2] ? ' (page ' + e[2] + ')' : ''));
  }
  return { document: d.name, profile: prof.name, problems: problems, byRule: byRule, samples: samples };
} finally { try { proc.remove(); } catch (e) {} }
