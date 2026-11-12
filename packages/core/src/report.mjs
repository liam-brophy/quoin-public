// A plain-language build report for the designer / production editor.

export function reportMarkdown({ book, docx, template, profile, resolved, indesign }) {
  const { report: r, fit, character, topics } = resolved
  const L = []
  L.push(`# ${book}: build report`, '')
  L.push(`- Manuscript: \`${docx}\``, `- Template: \`${template}\``, `- Tag profile: ${profile.name}`, '')

  L.push('## Manuscript', '')
  L.push(`${r.paragraphs} paragraphs in ${topics.length} topics. ${r.placeholders} placeholder paragraphs emptied.`)
  const problems = []
  if (Object.keys(r.unknownTags).length) problems.push(`Tags not in the profile: ${list(r.unknownTags)}`)
  if (r.untaggedParagraphs) problems.push(`${r.untaggedParagraphs} untagged ("Normal") paragraphs`)
  if (r.unclosedContainers.length) problems.push(`Containers without an \`end\`: ${r.unclosedContainers.map((u) => `${u.topic} (${u.containers.join(', ')})`).join('; ')}`)
  if (r.strayContainerEnds) problems.push(`${r.strayContainerEnds} \`end\` tags with no container open`)
  if (r.notes) L.push(`${r.notes} footnotes carried into the ICML (InDesign numbers them).`)
  if (character.directFormattingRuns) problems.push(`${character.directFormattingRuns} runs used direct formatting instead of a character style (mapped to i/b/sc…)`)
  L.push('', problems.length ? problems.map((p) => `- ${p}`).join('\n') : '- No tagging problems found.', '')

  if (fit) {
    L.push(`## Styles the template didn't have (${fit.missing.length})`, '')
    L.push('Created in the document with these names, based on the nearest existing style. Style them, or add them to the template.', '')
    L.push('| Style | Paragraphs | Based on |', '|---|---:|---|')
    for (const m of fit.missing) L.push(`| \`${m.name}\` | ${m.count} | \`${m.basedOn}\` |`)
    L.push('')
  }
  const missingChar = character.used.filter((c) => c.inTemplate === false)
  if (missingChar.length) L.push(`Character styles created empty: ${missingChar.map((c) => `\`${c.name}\` (${c.count})`).join(', ')}`, '')

  if (indesign) {
    L.push('## InDesign', '')
    L.push(`${indesign.pages} pages. ${indesign.oversetStories} overset stories. ${indesign.createdParagraph} paragraph and ${indesign.createdCharacter} character styles created.`)
    if (indesign.warnings.length) L.push('', ...indesign.warnings.map((w) => `- ⚠ ${w}`))
    if (indesign.fontsReplaced?.length) L.push('', `Fonts replaced in this copy (house rule; the template still has them): ${indesign.fontsReplaced.length} styles`, ...indesign.fontsReplaced.map((f) => `- ${f}`))
    L.push('', '| Topic | ICML | Pages |', '|---|---|---|')
    for (const t of indesign.topics) L.push(`| ${t.title} | ${t.file} | ${t.startPage}–${t.endPage}${t.overset ? ' ⚠ overset' : ''} |`)
    if (indesign.excluded?.length) L.push('', `Left out of print: ${indesign.excluded.join(', ')} (ICML still written).`)
  }
  return L.join('\n') + '\n'
}

const list = (o) => Object.entries(o).map(([k, v]) => `\`${k}\` ×${v}`).join(', ')
