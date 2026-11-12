// Carries an InDesign book's body and heading styles into Typestory's settings
// model (see typestory/src/settings.ts: FontPairing, ReaderSettings).

/** Typestory's leading steps (LEADING in settings.ts), as line-height ÷ size. */
export const LEADING = { tight: 1.42, normal: 1.58, loose: 1.78 }

const WEIGHTS = [
  [/thin|hairline/i, 100], [/extra ?light|ultra ?light/i, 200], [/light/i, 300],
  [/semi ?bold|demi/i, 600], [/extra ?bold|ultra ?bold/i, 800], [/black|heavy/i, 900],
  [/bold/i, 700], [/medium/i, 500],
]

export function weightOf(fontStyle) {
  for (const [re, w] of WEIGHTS) if (re.test(fontStyle ?? '')) return w
  return 400
}

/** Leading in points; InDesign's Auto leading is a percentage of size. */
export function leadingPt(style) {
  return typeof style.leading === 'number' ? style.leading : style.pointSize * (style.leading.percent / 100)
}

/**
 * Pick Typestory's reader defaults from the book's body paragraph style.
 * `body` is one entry from the styles tool (all measurements in points):
 *   { pointSize, leading, firstLineIndent, spaceBefore, spaceAfter, ... }
 *
 * @returns {{ leading: 'tight' | 'normal' | 'loose', paragraphs: 'spaced' | 'indented' }}
 */
export function readerSettingsFrom(body) {
  // TODO(human)
}

/**
 * Build a Typestory FontPairing + ReaderSettings proposal.
 * Typestory's baseSize is a screen size in px, tuned per face, so it can't be
 * derived from the print size; we keep Typestory's default and report the print
 * values alongside so the designer can judge.
 */
export function toTypestory(body, heading, { id = 'from-indesign', name = 'From InDesign' } = {}) {
  const family = (f, fallback) => `"${f?.family ?? 'serif'}", ${fallback}`
  const serif = 'Georgia, serif'
  const sans = '"Helvetica Neue", Arial, sans-serif'
  return {
    pairing: {
      id,
      name,
      note: `${body.font?.family ?? '?'}${heading && heading.font?.family !== body.font?.family ? ` with ${heading.font?.family}` : ''}`,
      body: family(body.font, serif),
      heading: family((heading ?? body).font, serif),
      headingWeight: weightOf((heading ?? body).fontStyle),
      ui: family({ family: 'Inter' }, sans),
      baseSize: 21,
    },
    settings: readerSettingsFrom(body),
    print: {
      bodySize: body.pointSize,
      bodyLeading: Math.round(leadingPt(body) * 100) / 100,
      ratio: Math.round((leadingPt(body) / body.pointSize) * 1000) / 1000,
      firstLineIndent: body.firstLineIndent,
      spaceAfter: body.spaceAfter,
      headingSize: heading?.pointSize ?? null,
    },
    notes: [
      'Typestory needs static web fonts: check each family has a static web build (no opsz/variable axes).',
      'baseSize is left at 21px; tune it so x-heights match the other pairings.',
    ],
  }
}
