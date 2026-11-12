# Tag profiles

A profile is a tag library: the names an editor uses to mark up a manuscript, and the rules that turn those names
into the styles in a designer's template. Quoin ships with **Basic**. A publisher's own tag set goes in a private
profile.

## Where profiles live

Looked for in this order:

1. the folder named by the environment variable `BOOK_PROFILES_DIR`
2. `~/.book-core/profiles`
3. Quoin's built-in `packages/core/profiles` (Basic)

If you have a profile of your own, it becomes the default. `BOOK_PROFILE=<name>` picks one explicitly.

## What a profile says

`<name>.json` (and optionally `<name>.extra.json`, merged over it, for hand-kept house rules):

| Key | Meaning |
| --- | --- |
| `topics` | The parts of a book (`topic-chapter` → abbreviation `chap`). A topic becomes one linked story and one EPUB file |
| `paragraph` | Paragraph tags: label, whether runs of it take first/middle/last/only variants (`fmlo`), containers |
| `character` | Character styles (italic, small caps, speaker labels…) |
| `wordStyles` | Word's built-in styles mapped to tags (`heading 1` → chapter title), so plain files start structured |
| `contextual` | Position rules: the first paragraph of a chapter, or after a heading or break, takes another style |
| `fmloGroups`, `containerVariants` | Which different tags count as one block; how position inside a container is named |
| `placeholders` | Text that exists only to keep an empty paragraph (a break marker) |
| `pagination`, `signature` | Which topics start on a right or left page; the print signature (16, or 4 for a booklet) |
| `fonts` | Families the house never uses and what replaces them in a built copy |
| `autoCharacter` | Styles applied automatically by writing system (Greek, Hebrew, Japanese…) or pattern |
| `footnotes` | Footnote paragraph and reference styles |
| `epub` | Which tags are headings, block quotes, lists, breaks and opener lines; language codes |
| `taggingGuide` | Plain sentences Claude reads before tagging: your house conventions |

Style names are built as `topic_tag[_variant]` (for example `chap_quote_first`). If your template spells a style
differently, the template wins.

## Starting your own

Copy `basic.json` to `~/.book-core/profiles/<yourhouse>.json` and edit it. For a large style list kept as a
spreadsheet, `packages/core/scripts/profile-from-xlsx.py` shows how one is generated; adapt it to your sheet's
columns.

Then test it on a book you have already finished: open the tagged manuscript with `ignoreTags`, let Claude tag it,
and run `manuscript_score` to compare with your editor's tags. Each difference is either a rule to add to the
profile or a sentence to add to `taggingGuide`.
