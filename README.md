# Quoin

**From manuscript to finished book, with Claude and Adobe InDesign.**

*A quoin (said "coin") is the wedge that locks a page of type in its frame so it can go to press.*

Quoin is a plugin for [Claude Code](https://claude.com/claude-code). It handles the repeatable parts of making a
book, zine or booklet (structuring the text, flowing it into your template, placing art, checking, exporting) so
that you can spend your time on the design. You stay in charge: anything that changes your document is shown to you
first.

> Quoin is an independent project. It is not made, sponsored or endorsed by Adobe. Adobe and InDesign are
> trademarks of Adobe Inc.

## What you can ask for

| You say | Quoin does |
| --- | --- |
| "Tag this manuscript" | Reads the Word file, proposes the structure (chapters, headings, extracts, letters, verse, breaks) as rules you can review, and lists anything it is unsure of |
| "Flow it into my template" | Makes a copy of your template with every chapter flowed and styled, one linked story per chapter, and a report of what it created or guessed |
| "Here's the art log" | Marks where each image goes with a note in the text, checks resolution and colour, and places anchored, captioned frames when you approve |
| "Make the EPUB" | Writes a validated, accessible EPUB 3 with real headings, alt text, pop-up footnotes and, if you like, chapter openers that look as they do in print |
| "It needs to be 384 pages" | Reports how far off the build is and tries one change at a time with you |
| "Set up an 8-page zine, half letter" | Creates the document with a type system from fonts you have, then imposes it for printing and folding |
| "Is this ready for the printer?" | A handoff check (links, fonts, overset text, image resolution, preflight, page count against the signature, unused styles), then the print PDF and a package folder for the printer |

## What you need

- A Mac with Adobe InDesign (2024 or later) for the InDesign tools. **Windows is coming in a later release**;
  the manuscript and EPUB tools in `packages/core` are plain Node.js, but are not yet tested on Windows
  (image conversion for EPUBs uses a Mac tool, so images must already be JPEG or PNG there).
- [Claude Code](https://claude.com/claude-code) and [Node.js](https://nodejs.org) 20 or later
- For EPUB checks: Java (for EPUBCheck) and `npm install -g @daisy/ace`, both optional

The part that needs no InDesign (reading manuscripts, tagging jobs, writing EPUBs) is a separate package,
[`packages/core`](packages/core), and runs on any computer.

## Install

In Claude Code:

```
/plugin marketplace add liam-brophy/quoin-public
/plugin install quoin
```

The first time it starts, Quoin downloads its dependencies (about a minute). The first time it talks to InDesign,
macOS asks whether Claude Code may control InDesign: allow it (System Settings › Privacy & Security › Automation).

## How it works

1. **Tags, not guesses.** Every paragraph gets a tag from a *profile*: a tag library. Quoin ships with **Basic**
   (plain-language tags for most books and zines). Publishers add their own house tag set as a private profile:
   see [docs/PROFILES.md](docs/PROFILES.md).
2. **Claude proposes, code repeats, you approve.** Claude reads the manuscript and writes tagging *rules*; code
   applies them to the whole book and turns tags into your template's exact style names. The same rules always give
   the same book.
3. **Your template decides the look.** Quoin never chooses your fonts or spacing for a book. Styles your template
   lacks are created under the right name, based on the nearest one you have, and listed for you to design.
4. **Nothing changes without you.** Builds work on copies. Adding pages, removing styles, placing art, or running
   one of your own scripts all start with a preview.

## Your data

Tagging with Claude means the parts of the manuscript Claude reads are sent to Anthropic, as with anything you
show Claude. Everything else runs on your computer. See [PRIVACY.md](PRIVACY.md) before using Quoin on
unpublished work.

## Tools

<details><summary>All tools, by stage</summary>

| Stage | Tools |
| --- | --- |
| Manuscript | `profile_tags`, `manuscript_open`, `manuscript_shapes`, `manuscript_outline`, `manuscript_find`, `manuscript_scenes`, `manuscript_rules`, `manuscript_review`, `manuscript_score`, `manuscript_art` |
| Build | `book_build` (optional trim, margins, target page count) |
| Art | `art_check`, `art_place` |
| Finish | `book_signature`, `book_unused_styles`, `book_epub_prep`, `book_epub`, `book_epub_direct`, `book_epub_openers`, `book_pdf`, `book_package` |
| Design | `design_fonts`, `design_new_document`, `design_impose` |
| InDesign | `indesign_status`, `indesign_inspect_document`, `indesign_list_styles`, `indesign_export`, `indesign_run_script` |
| Your scripts | `designer_scripts`, `designer_script_run` (see [designer-scripts/README.md](designer-scripts/README.md)) |

</details>

## For developers

```sh
npm install        # also links packages/core
npm test           # book-core self-tests (no InDesign needed)
npm run smoke      # end-to-end check against InDesign
```

`server/` is the MCP server and the InDesign bridge (AppleScript `do script`, so macOS only for now),
`skills/indesign/` teaches Claude the workflows, `designer-scripts/README.md` explains how to register your own InDesign scripts so Quoin can run them
without their dialogs, `packages/core` is book-core.

## Status and licence

Early release: tested on a small number of real books. The InDesign tools are Mac-only for now; a Windows release
is planned, and will follow once it can be tested on Windows.
Licensed under the [Apache License 2.0](LICENSE): use, change and share it, including commercially, with credit
(see [NOTICE](NOTICE)). The licence covers the code, not the project's name.
