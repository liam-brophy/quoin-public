// schema.org accessibility metadata for an EPUB package: the publisher's claims, written only as given.
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * @param {{ accessMode?: string[], accessModeSufficient?: string[], features?: string[], hazards?: string[], summary?: string,
 *           conformsTo?: string, certifiedBy?: string, printIsbn?: string, pageBreakSourceProperty?: boolean }} a
 * @returns {{ lines: string[], prefixes: string[] }}
 */
export function a11yMetadata(a) {
  const lines = [], prefixes = []
  for (const m of a.accessMode ?? []) lines.push(`<meta property="schema:accessMode">${esc(m)}</meta>`)
  for (const m of a.accessModeSufficient ?? []) lines.push(`<meta property="schema:accessModeSufficient">${esc(m)}</meta>`)
  for (const f of a.features ?? []) lines.push(`<meta property="schema:accessibilityFeature">${esc(f)}</meta>`)
  for (const h of a.hazards ?? []) lines.push(`<meta property="schema:accessibilityHazard">${esc(h)}</meta>`)
  if (a.summary) lines.push(`<meta property="schema:accessibilitySummary">${esc(a.summary)}</meta>`)
  if (a.conformsTo) lines.push(`<meta property="dcterms:conformsTo">${esc(a.conformsTo)}</meta>`)
  if (a.certifiedBy) lines.push(`<meta property="a11y:certifiedBy">${esc(a.certifiedBy)}</meta>`)
  if (a.printIsbn) {
    const urn = `urn:isbn:${esc(a.printIsbn.replace(/[^0-9Xx]/g, ''))}`
    if (a.pageBreakSourceProperty) lines.push(`<meta property="a11y:pageBreakSource">${urn}</meta>`)
    lines.push(`<dc:source id="pagination-source">${urn}</dc:source>`, `<meta refines="#pagination-source" property="source-of">pagination</meta>`)
  }
  if (a.certifiedBy || a.pageBreakSourceProperty) prefixes.push('a11y: http://www.idpf.org/epub/vocab/package/a11y/#')
  return { lines, prefixes }
}
