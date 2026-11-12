# book-core

Everything between a Word manuscript and a tagged, resolved book: **no InDesign, no Claude**. Runs anywhere
Node 20+ runs (a laptop, a server, CI).

| Module | Does |
| --- | --- |
| `docx` | Reads a .docx: paragraphs, Word styles (tags), character styles, direct formatting, footnotes with positions |
| `profile` | Tag libraries: `profiles/<name>.json` (generated from a style list) + `<name>.extra.json` (house rules, tagging guide) |
| `job` | Tagging jobs: ordered rules (paragraph, topic, container, character) recomputed into tags; automatic language styles |
| `outline` | Compact views for tagging: shortlist, shapes, find, scenes |
| `resolve` | Tags → exact house style names (FMLO, groups, containers, `pf`/`pfada`, template fallbacks) |
| `icml` / `book` | One ICML per topic with house file names (`A001_<ISBN>_<Title>.icml`), footnotes included; report |
| `epub` / `css` / `idml` | EPUB 3 written directly: a file per topic with `epub:type`/ARIA roles, headings, block quotes, lists, pop-up footnotes, `lang` spans; CSS from the template's styles (IDML) |
| `validate` / `a11y` | EPUBCheck and DAISY Ace, summarised; accessibility metadata written only as given |
| `art` | Art logs (CSV/XLSX): where each piece goes (manuscript callouts or anchor phrases); art notes in the ICML |
| `impose` | Page order for saddle-stitch booklets and one-sheet mini-zines |
| `review` / `score` | The editor's review list; scoring a job against the editor's own tags |

```sh
npx book-core icml Manuscript.docx --out out/Book          # tagged manuscript -> ICML + report.md
npx book-core epub Manuscript.docx --out Book.epub --title "Title" --idml template.idml [--a11y a11y.json]
                                                           # tagged manuscript -> checked EPUB, no InDesign
npx book-core job open Manuscript.docx --out out/Book      # start a tagging job
npx book-core job review out/Book/Book.job.json            # review list for the editor
npm test                                                   # self-test, no private files needed
```

Profiles: see [docs/PROFILES.md](../../docs/PROFILES.md). `basic` is built in (plain-language tags; Word's Title and Heading styles map to structure automatically).
`scripts/profile-from-xlsx.py` turns a publisher's style list (.xlsx) into a profile. A publisher's style
list may be proprietary: don't ship one in a public release; ship the generator and an example profile instead.
