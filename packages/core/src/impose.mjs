// Imposition: the order pages are printed in so a folded sheet reads correctly. Pure arithmetic.

/**
 * Saddle-stitched booklet (sheets folded in half and nested). Pads to a multiple of 4 with blanks (null).
 * @returns {{ total: number, blanks: number, sides: Array<{ sheet: number, side: 'front'|'back', pages: [number|null, number|null] }> }}
 */
export function saddleStitch(n) {
  if (!(n >= 1)) throw new Error('A booklet needs at least one page.')
  const total = Math.ceil(n / 4) * 4
  const pg = (k) => (k <= n ? k : null)
  const sides = []
  for (let i = 0; i < total / 4; i++) {
    sides.push({ sheet: i + 1, side: 'front', pages: [pg(total - 2 * i), pg(1 + 2 * i)] })
    sides.push({ sheet: i + 1, side: 'back', pages: [pg(2 + 2 * i), pg(total - 1 - 2 * i)] })
  }
  return { total, blanks: total - n, sides }
}

/**
 * One-sheet mini-zine: 8 pages on one side of a sheet, cut along the centre and folded.
 * Page 1 is the front cover, page 8 the back. The top row prints upside down.
 * @returns {{ rows: Array<{ rotate: 0|180, pages: Array<number|null> }> }}
 */
export function miniZine(n = 8) {
  if (n > 8) throw new Error(`A one-sheet mini-zine holds 8 pages; this document has ${n}.`)
  const pg = (k) => (k <= n ? k : null)
  return { rows: [{ rotate: 180, pages: [5, 4, 3, 2].map(pg) }, { rotate: 0, pages: [6, 7, 8, 1].map(pg) }] }
}
