# Product manifest · <PRODUCT NAME>

Copy to `<repo>/.claude/product.md` and fill every `<PLACEHOLDER>`. Universal agents
read this file before producing any copy or UI for this repo. Keep it lean — this is
context every session pays for.

## Personas

|            | <AUDIENCE-1, e.g. "consumer">      | <AUDIENCE-2, e.g. "pro" — delete column if single-audience> |
| ---------- | ---------------------------------- | ----------------------------------------------------------- |
| Persona    | <name · one line on who they are>  | <name · one line>                                           |
| Job        | "<what they hire the product for>" | "<...>"                                                     |
| Vocabulary | <words THEY use>                   | <words they use>                                            |
| Device     | <mobile-first / desktop-first>     | <...>                                                       |
| Routes     | <route group, e.g. `/(consumer)/`> | <route group>                                               |

## Voice per audience

- **<AUDIENCE-1>:** <one sentence — e.g. warm, plain English, outcome-first, short
  sentences, jargon explained inline>.
- **<AUDIENCE-2>:** <one sentence — e.g. tool-y, precise, numbers over adjectives,
  jargon expected>.
- Shared: active voice, sentence case in UI, imperative CTAs, one apology max per
  error, no "please", no exclamation marks in errors.

## Palette tokens

| Token                         | Value  | Used for                 |
| ----------------------------- | ------ | ------------------------ |
| `--color-bg-<audience-1>`     | <#hex> | <AUDIENCE-1> surfaces    |
| `--color-accent-<audience-1>` | <#hex> | <AUDIENCE-1> primary CTA |
| `--color-bg-<audience-2>`     | <#hex> | <AUDIENCE-2> surfaces    |
| `--color-accent-<audience-2>` | <#hex> | <AUDIENCE-2> primary CTA |

Never mix the audiences' palettes on one page.

## Banned words

Words that must never appear in that audience's UI copy. If one must appear (e.g.
in a tooltip), explain it inline in plain language.

- **<AUDIENCE-1>:** <e.g. acronym/jargon list — ICP, CTR, LCP, schema, ...>
- **<AUDIENCE-2>:** <e.g. hand-holding filler — "Great job!", "Don't worry!", ...>

## Information density

- **<AUDIENCE-1>:** <e.g. max 4 KPIs above the fold, one CTA per screen, no dense
  tables on the home page, big numbers + whitespace>.
- **<AUDIENCE-2>:** <e.g. dense tables first-class, 6–8 KPIs across, bulk actions,
  keyboard shortcuts, side rails for context>.
- Empty states always say WHY it's empty + WHAT to do next — never "No items".
