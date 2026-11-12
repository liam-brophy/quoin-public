---
name: indesign
description: Work in Adobe InDesign on this Mac through the indesign MCP tools. Use when the user asks to tag a manuscript (a publisher's tag library, or the built-in Basic one), flow a manuscript into a template, inspect, preflight, typeset, restyle, export (PDF, EPUB, IDML) or batch-process InDesign documents, or write InDesign scripts.
---

# Working in InDesign

The user is a professional book designer. Their documents are finished work: treat them carefully, and
get typographic details right (real quotes and dashes, indents, spacing after headings).

## Tools

| Tool | Use for |
| --- | --- |
| `indesign_status` | First call in a session: confirms InDesign answers, lists open documents. |
| `indesign_inspect_document` | Page setup, margins, grid, masters, overset text, missing fonts and links. |
| `indesign_list_styles` | Type specs of paragraph/character styles. Pass `names` to keep the reply small. |
| `indesign_export` | PDF / IDML / EPUB. For a batch, call once per file with `source`. |
| `indesign_run_script` | Anything else, as ExtendScript. One undo step per call. |
| `indesign_typestory_pairing` | Body + heading styles → Typestory `FontPairing` and `ReaderSettings`. |
| `profile_tags`, `manuscript_*`, `book_build` | Tagging a manuscript and flowing it into a template (below). |

All measurements are **points**. Read before you write: inspect and list styles before changing anything.

## Tagging a manuscript

The production editor's job, done with them: Claude proposes tags as **rules**, code applies them, the editor
reviews. Never tag paragraph by paragraph across a whole book.

| Step | Tool | What to do |
| --- | --- | --- |
| 1 | `profile_tags` | Read the house **guide** first; it records conventions earlier books taught. Search tags as needed. |
| 2 | `manuscript_open` | Pass the `.docx` and an output folder. A tagged file keeps its tags as rules. |
| 3 | `manuscript_shapes` | See the whole book's recurring shapes: headings, bracketed lines, breaks, repeats. |
| 4 | `manuscript_outline` | Read the shortlist (front matter and lines that may be display text), paging with `cursor`. |
| 5 | `manuscript_rules` | Write rules: one per pattern (`where.text` regex, `range`, `within`), exact `indices` only for one-offs. |
| 6 | `manuscript_find` / `manuscript_outline` mode `all` | Check cues in the prose ("a text came in:", "the story read") and read what follows. |
| 7 | `manuscript_scenes` + outline mode `dialogue` | For distinct voices: find the scenes, read the dialogue, propose containers. |
| 7b | `manuscript_rules` with `kind: "char"` | Character styles: speaker labels (`match` on `currentTag`), whole voice paragraphs (`inContainer`), lines a compositor note points at. Language runs and redaction are automatic: never write rules for them. |
| 8 | `manuscript_review` | Hand the editor the review list (`<book>.review.md`). Say what is uncertain. |
| 9 | `book_build` | Only when the user asks: flow the job into a copy of their template. |

Rules:

- **Topics first** (`kind: "topic"` marks where each starts), then front matter, then body patterns, then one-offs.
  Later rules override earlier ones, so a broad rule can be followed by exceptions.
- **Every judgement call gets a note.** Use `confidence: "low"` when you are unsure, `review: true` when the
  guide calls it the editor's choice. The note is what the editor reads.
- **Voices are proposals.** Read every scene `manuscript_scenes` returns, including the neighbouring ones it
  adds: a character can speak in a scene that never names them. Short ambiguous lines ("No.") get low confidence.
- **Unknown tag?** The refusal lists close matches; never invent tags. A house extension the guide doesn't
  mention is a question for the user, not a guess.
- **Testing on a finished book:** open it with `ignoreTags: true`, tag it, then `manuscript_score`. Don't look at
  the score until the tagging is done, and say which guide lines it should add.

## Rules for editing

- Never save, close, or "Save As" over the user's document unless they asked. Exports are fine.
- Change **styles**, not local overrides. If text has overrides, report them before clearing them.
- Give every editing call a clear `undoName` ("Apply Body style to chapter 3") so the user can
  Cmd-Z it as one step.
- Before a change touching more than one story or more than a few pages, say what will change and ask.
- Report overset text, missing fonts and modified links whenever you see them, even if not asked.

## Art: art logs, image checks, placement

Production art follows the art log the editor provides. The plugin carries it to the page; it decides nothing
about the art itself.

1. `manuscript_art` matches the log (CSV/XLSX; columns found by name) to the job. A piece goes where the
   manuscript calls for it ("[Insert Fig. 2.1]", "<photo3.jpg>", a compositor note naming the file; the callout is
   removed from the text), else after the paragraph its Placement phrase names (scoped by its Chapter column).
   Report anything unmatched or ambiguous and ask; never guess a place.
2. `art_check` before placing: effective ppi at the size the log asks for, colour space against how the book
   prints (`1c`/`2c`/`4c`: ask), formats needing conversion. Flags only; converting is the designer's call.
3. `book_build` writes each piece as an InDesign Note (Window › Editorial › Notes) where it goes: the designer
   sees them like a production editor's notes.
4. `art_place` only when the designer asks: dry run first, then `approved: true`. Pieces narrower than the column
   (half, quarter, a width in inches) wrap; column-width and full-page pieces sit above the line. Missing files get
   a grey placeholder. Pass on every `gap` it reports: art that didn't fit leaves a short page, and resizing or
   moving it is the designer's decision.

## Zines, booklets and other short projects

Not every project is a tagged book. For a zine, booklet, programme or flyer:

- **Ask for the specs first**: finished size, page count, how it will be printed and bound (home printer and
  stapled? one-sheet fold? print shop?), and what content exists. The binding decides the page count: saddle-stitch
  needs a multiple of 4, a one-sheet mini-zine is exactly 8.
- `design_fonts` shows what InDesign can use on this computer. **Propose two or three pairings from that list**
  with a sentence on each one's character, and let the user choose. Never assume a font is installed. For an Adobe
  Fonts family that isn't listed, the user activates it at fonts.adobe.com; you can't.
- `design_new_document` makes the file from the agreed specs with a starter type system (body, heads, captions).
  It is a starting point for the user to design on, not a finished layout.
- Plain Word files work with the **basic** profile (`manuscript_open` with `profile: "basic"`): Title and Heading
  styles become structure automatically, and you add rules for the rest. Then `book_build` or `book_epub_direct`.
- `book_build` takes `page` (a different trim or margins) and `targetPages`. To hit a page count, change one thing,
  rebuild, compare; say what you changed. Type size and leading live in the template and are the designer's call.
- `design_impose` makes the print-ready sheet order (`saddle-stitch` or `mini-zine`) as a new PDF, leaving the
  design file alone. Pass on the folding notes it returns.
- Templates: the user can open any InDesign or Adobe Stock template they have and use it as the `template` for
  `book_build`; styles the book needs and the template lacks are created and listed in the report.

## The designer's own scripts

`designer_scripts` lists the designer's own scripts the plugin can run without their dialogs (registered in
`~/.quoin/scripts/registry.json`; see `designer-scripts/README.md`). They are the designer's tools, not steps
of the build:

- **Run one only when the designer asks.** Never chain them after `book_build` or suggest running them all.
- **Report scripts** (kind `report`) are read-only: run and summarise what they found.
- **Scripts that change the document** (kind `changes`): run the dry run (`dryRun: true`) or preview
  (`preview: true`) first, show the designer what would change, and pass `approved: true` only after they agree.
  A real run is one undo step; say so. Pass on any `caution` the registry gives (for example, stories checked out,
  which Undo does not reverse).
- A script whose settings need the designer's choices (which style gets which master) is asked, not guessed; use
  names exactly as InDesign's panels show them.
- Nothing is saved: tell the designer the document is open with unsaved changes.

## Finishing a book (export phase)

Reports and exports run freely; anything that changes the document is shown first and done only on approval.

1. `book_signature`: report pages against the 16-page signature. Where extra pages go (blank, ads, card page
   moved) is the designer's call: ask; add them only with `approved: true`.
2. `book_epub_prep`: dry run first. Show the planned export tagging (headings, block quotes, file splits, languages,
   metadata) and ask for any title / author / publisher / e-book ISBN you can't read from the copyright pages.
   Apply with `approved: true`.
3. `book_epub`: exports and runs EPUBCheck and DAISY Ace. Accessibility metadata are the **publisher's claims**:
   propose values from what you know (text-only novel → `textual`, hazards `none`), confirm them with the designer,
   and never add `conformsTo` or `certifiedBy` unless the publisher states them. Pass `printIsbn` so the print page
   numbers have a source. Report what each checker found, plainly.
   **Two ways to an EPUB.** `book_epub_direct` writes it from the tagged manuscript or job, with no InDesign:
   better structure (chapter/dedication/copyright semantics, block quotes, lists, pop-up notes, languages) and the
   template's typography from its IDML (ask the designer to File › Save As › IDML once). Prefer it unless the
   EPUB must carry print page numbers, which only `book_epub` (InDesign's export, after layout) has.
   **Images in the EPUB.** With `images` (the art folder), every piece `manuscript_art` placed becomes a figure
   with its caption, credit and alt text; a piece with no alt text is reported, so ask for one. `ornament` puts an
   image at ornamented breaks. For chapter starts that look as they do in print, run `book_epub_openers` on the
   designed document (after the designer has styled the openers) and pass its folder as `openers`: each chapter
   then opens with its heading block as one image at column width, with the heading text as alt text. Warn that
   dark type on a transparent image can vanish in a reader's night mode (`transparent: false` gives a white panel).
   When the EPUB has images, the accessibility metadata should list `visual` too: confirm with the designer.
4. `book_pdf`: preflight, print PDF with the house preset, signature warning.
5. At handoff only: `book_unused_styles`; show the list, remove with `approved: true`.
6. `book_package` for the printer or the next designer. First call it without `approved`: show the blockers
   (missing links or fonts, overset text, unsaved changes) and the things to review. Fixing them is the designer's work;
   offer, don't do. Then, with `out` (a new, empty folder) and `approved: true`, it runs File > Package: fonts, links,
   IDML, Instructions.txt, and a PDF if asked. It never saves the document: if there are unsaved changes, ask the
   designer to save. Say that Adobe Fonts are not copied and the printer activates them.

## Writing ExtendScript for `indesign_run_script`

ExtendScript is **ES3**: `var` only, no `let`/`const`, arrow functions, template strings,
`Array#map/forEach/indexOf`, or `JSON`. The prelude supplies:

- `ARGS` — the `args` object you passed.
- `__doc()` — `ARGS.document` if given, else the active document; throws if none is open.
- `__font(f)` — `{ family, style, status }` from a Font or font name.
- Return plain data; the prelude serialises it. Enums come back as their names.

Performance: InDesign DOM calls are slow one at a time. Use `everyItem()` to read or set a property on a
whole collection in one call, e.g. `d.stories.everyItem().paragraphs.everyItem().appliedParagraphStyle`.
Prefer `findGrep` / `changeGrep` for text changes across a document:

```js
app.findGrepPreferences = app.changeGrepPreferences = NothingEnum.NOTHING;
app.findGrepPreferences.findWhat = '(?<=\\d)-(?=\\d)';   // hyphen between figures
app.changeGrepPreferences.changeTo = '~=';               // en dash
var hits = __doc().changeGrep();
app.findGrepPreferences = app.changeGrepPreferences = NothingEnum.NOTHING;
return { changed: hits.length };
```

Always reset find/change preferences before and after, as above.

**An InDesign error can undo your script's earlier work**, even inside `try/catch` (seen with assigning a font
that isn't available: page count and facing-pages settings made earlier in the script were silently reverted).
Check before acting instead of catching the error: for fonts, look the name up in `app.fonts.everyItem().name`
(even `itemByName(...).isValid` raises it for a missing family); and verify results by reading them back.

**Placed ICML stories are locked** (checked in). Find/change skips them silently unless
`app.findChangeTextOptions.includeLockedStoriesForFind = true` (and `findChangeGrepOptions` for GREP): set it,
and restore it after. To *change* text in them, check the story out first (`story.checkOut()`), as
RemoveChapterPrefix does. A clean-up that reports 0 changes on a freshly built book is almost always this.

## Recipes

**Preflight report.** `indesign_inspect_document`, then summarise: overset stories (with their opening
words), missing fonts, links, and anything off-grid (body style `alignToBaseline` false while a grid is set).

**Typesetting a manuscript into a template.** Open the template (or have the user open it), list its
styles, then in one script: place the file into the primary text frame with autoflow
(`page.place(file, [x, y], undefined, false, true)` or thread frames), map Word styles to template styles
(`importedStyles` via `app.wordRTFImportPreferences` or by applying styles afterwards), then clean up:
straight quotes → typographer's quotes (`d.textPreferences.typographersQuotes = true` then re-place, or GREP),
double spaces, spaced hyphens → en/em dashes per the house style. Ask which dash style the book uses.

**Batch export.** List the files (Bash `ls`), then `indesign_export` with `source` for each; report
failures per file and carry on.

**Typestory bridge.** Ask which styles are body and chapter heading if their names are not obvious, call
`indesign_typestory_pairing`, and present the proposal as a `FontPairing` entry for
`typestory/src/settings.ts` alongside the print values. Typestory needs static web fonts: flag families
that only exist as desktop or variable fonts.

## When InDesign does not answer

- "macOS blocked automation" → System Settings → Privacy & Security → Automation: allow the app running
  Claude Code to control InDesign.
- Timeout → a modal dialog is probably open in InDesign; ask the user to dismiss it.
- Wrong version → `INDESIGN_APP` in the plugin's `.mcp.json` names the app (default "Adobe InDesign 2026").
