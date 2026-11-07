# Many Hats brand

**The mark.** A top hat (work) with a cap (personal) stepping out in front of it: one person, several accounts.

- It's drawn in code in [`shapes.mjs`](shapes.mjs) on a 256 × 256 grid.
- `npm run brand` builds every asset from it (needs `rsvg-convert`: `brew install librsvg`).

| File                                | Use                                                          |
| ----------------------------------- | ------------------------------------------------------------ |
| `mark.svg`                          | The colour mark on its tile: the master.                     |
| `mark-mono.svg`                     | The one-colour mark: a single flat path.                     |
| `../media/icon.png`                 | Store icon, 256 × 256.                                       |
| `../media/activity.svg`             | Activity-bar icon. The editor tints it, so any colour works. |
| `../media/glyphs.woff`              | Status-bar glyph `$(many-hats-logo)`, U+E001.                |
| `../docs/images/social-preview.png` | GitHub social preview, 1280 × 640.                           |
| `../docs/images/header.png`         | README header.                                               |

## Colours

| Name      | Hex                   | Where                                            |
| --------- | --------------------- | ------------------------------------------------ |
| Night     | `#14113A` → `#312C85` | Tile and banner gradient; store banner `#1E1B4B` |
| Paper     | `#E0E7FF`             | Top hat                                          |
| Band      | `#6366F1`             | Top hat band                                     |
| Mint      | `#5EEAD4`             | Cap                                              |
| Mint deep | `#2DD4BF`             | Cap bill                                         |
| Mint dark | `#14B8A6`             | Cap seam and button                              |

## Rules

- Keep the mark clear of Anthropic's and Claude's identity: no Claude orange, no starburst, no Claude Code mascot or ASCII art.
- "Claude Code" appears only to say what Many Hats works with: "for Claude Code".
- Don't recolour the mark, except to make it one colour (the mono mark).
- Leave at least 1/8 of its width clear around it.

## Concepts

`concepts/` keeps the three candidates drawn for the first release:

- `a-two-hats` (chosen);
- `b-split-band`: one hat with a three-colour band;
- `c-hat-stack`: three hats stacked.
