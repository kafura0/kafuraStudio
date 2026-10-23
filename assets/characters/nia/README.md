# Character asset folder — conventions

This folder holds the source material for one character's design pipeline. It is
**not** read by the application. Nothing here renders. See
[`docs/CHARACTER_WORKFLOW.md`](../../../docs/CHARACTER_WORKFLOW.md) for the process.

A file's folder **is** its status label. Do not move a file forward until the
workflow's approval gate for that step has passed.

| Folder | Status | Holds |
|---|---|---|
| `references/` | input | Raw source images. The current design sheet, appearance photos, and any merge proposals. Never approved work. |
| `prompts/` | process | The exact prompt, tool, version and date used to make each proposal, so it is reproducible. |
| `approved/` | approved | The current canonical design. Exactly one set is authoritative. |
| `expressions/` | approved | Approved facial-expression variants, authored from the approved face. |
| `parts/` | approved | Approved layered body parts for the future painted-art pipeline. |
| `environments/` | approved | Approved environment art for this character's sets. |

## Rules

- Only use images of a real person with their consent.
- Strip EXIF (`metadata`) before a file enters this folder.
- Do not upload private photos automatically. Check any tool's gallery/data-use settings first.
- Label honest status. A proposal in `references/` is a proposal, not the design.
- Do not invent creative canon here. Design decisions belong to the author
  (AGENTS.md RULE 13).

## Current state (Nia)

`references/` holds:

- `original_nia_design_bible.png` — the identity source to preserve.
- `current_appearance_reference.png` — one current-appearance view only;
  **front / 3-4 / side are still needed** before an identity merge.
- `nia_merged_identity_concept_sheet.png` — a merge proposal, not yet approved.

All other subfolders are empty until their gates pass. That is the honest state.
