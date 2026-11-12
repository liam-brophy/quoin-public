# Your own InDesign scripts

Quoin can run scripts you already use from InDesign's Scripts panel, without their dialogs: their alerts come
back as a report, and their yes/no questions get answers you choose in advance. It runs one only when you ask, and
a script that changes the document gets a dry run or a preview first.

## Registering a script

Put the script and a `registry.json` in `~/.quoin/scripts` (or a folder named by `QUOIN_SCRIPTS_DIR`):

```json
{
  "scripts": [
    {
      "id": "find-widows",
      "name": "Find Widows",
      "file": "FindWidows.jsx",
      "kind": "report",
      "description": "Lists widowed last lines at the top of a page or column. Changes nothing."
    },
    {
      "id": "apply-masters",
      "name": "Apply Masters by Style",
      "file": "MasterByStyle.jsx",
      "kind": "changes",
      "dryRun": true,
      "description": "Applies masters to pages by the paragraph styles on them.",
      "settings": { "paraRules": "[{ style, master }]: master names as the Pages panel shows them" },
      "caution": "Overrides local master changes on the pages it touches."
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `id`, `name`, `file` | How Claude refers to it, what you call it, the script file (relative to this folder, or absolute) |
| `kind` | `report` (reads only) or `changes` (edits the document: needs a dry run or preview, then your approval) |
| `dryRun` | The script honours `$.global.__HEADLESS__.dryRun` and reports without changing anything |
| `preview` | A separate read-only script that shows what the real one would change |
| `settings` | Settings the script reads from `$.global.__HEADLESS__.settings`, described for Claude |
| `caution` | Anything Undo can't reverse, said to you before a real run |

A script needs no changes to be run this way. To take settings or offer a dry run, it can check for
`$.global.__HEADLESS__` and fall back to its dialog when that is missing, so it still works from the Scripts panel.

Share only scripts you wrote or are licensed to share.
