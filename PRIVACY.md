# Your manuscripts and your data

Short version: Quoin itself collects nothing. What Claude reads is handled by Anthropic under your Claude plan.

## What stays on your computer

- Reading Word files, applying tagging rules, turning tags into style names, writing ICML and EPUB files
- Everything in InDesign: building, placing art, exporting, your own scripts
- EPUBCheck, Ace and image checks
- Job files, reports and review lists (saved in the folder you choose)

Quoin has no analytics, no account and no server of its own. It makes no network requests, apart from
downloading its own dependencies from npm the first time it runs.

## What is sent to Anthropic

Quoin is used through Claude. When you ask Claude to tag a manuscript, Claude calls Quoin's tools and **reads
their results**: outlines of the manuscript, passages it asks to see, style names, reports. Those results are part
of your conversation with Claude and are processed by Anthropic like anything else you show Claude.

- Claude does not read the whole book by default. It reads a shortlist (headings, display lines, front matter) and
  the passages it needs; for a novel that is typically a small part of the text. It can read more when a task
  needs it (for example, attributing a character's voice across scenes).
- How Anthropic stores and uses that content depends on your Claude plan and settings. Check them, and your
  organisation's agreement with Anthropic, before working on unpublished or contracted material.

## Working without sending text

A manuscript that is already tagged (by a production editor, in Word) needs no reading by Claude at all. The
`book-core` command-line tool in `packages/core` turns it into ICML or a checked EPUB entirely on your computer:

```sh
npx book-core icml Manuscript.docx --out out/Book
npx book-core epub Manuscript.docx --out Book.epub --title "Title"
```

## Your tag library

A publisher's style list can be confidential. Keep your profile in `~/.book-core/profiles` (or a folder named by
`BOOK_PROFILES_DIR`): it is read from there and is never part of Quoin's own files.
