import { BASE_URL } from "./http.js"
import type { VacancyResult } from "./types.js"

export interface VacancyResultFields {
  readonly id: string
  readonly title: string
  readonly company: string | null
  readonly location: string | null
  readonly date: string | null
  readonly deadline: string | null
  readonly hours: string | null
  readonly salary: string | null
  readonly educationLevel: string | null
  readonly contractType: string | null
  readonly summary: string | null
}

/** Build the shared search-result contract from parsed card fields. */
export function toVacancyResult(fields: VacancyResultFields): VacancyResult {
  return {
    id: fields.id,
    title: fields.title,
    company: fields.company,
    location: fields.location,
    date: fields.date,
    url: `${BASE_URL}/vacatures/${fields.id}`,
    deadline: fields.deadline,
    hours: fields.hours,
    salary: fields.salary,
    educationLevel: fields.educationLevel,
    contractType: fields.contractType,
    summary: fields.summary,
  }
}

// visibleHtml and stripInvisible below are copied from linkedin-search: the
// portal-skill contract's output-hygiene helpers.

/**
 * Characters a reader of the posting never sees but a model reading this
 * output does: C0/C1 controls other than tab, newline and carriage return, the
 * soft hyphen, bidi marks/embeddings/overrides/isolates, zero-width characters
 * and invisible operators, the BOM, variation selectors, and Unicode tag
 * characters (U+E0000-E007F), which can spell out a whole hidden instruction.
 */
const INVISIBLE_CHARS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F­؜᠎​-‏‪-‮⁠-⁯︀-️﻿\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu

/** Strip INVISIBLE_CHARS from every string in a result, recursively: the CLI's output boundary. */
export function stripInvisible<T>(value: T): T {
  if (typeof value === "string") return value.replace(INVISIBLE_CHARS, "") as T
  if (Array.isArray(value)) return value.map(stripInvisible) as T
  if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripInvisible(v)])) as T
  }
  return value
}

// Quoted attribute values may hold `>` or a close-tag string; neither ends the tag.
const ATTRS = String.raw`(?:[^>"']|"[^"]*"|'[^']*')*`

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"])

const NAMED_REFS: Readonly<Record<string, string>> = {
  colon: ":", semi: ";", amp: "&", nbsp: " ", tab: "\t", newline: "\n", lpar: "(", rpar: ")",
}

/**
 * An attribute value as the browser reads it: character references decoded,
 * with or without their closing semicolon, so `display&#58;none` or
 * `display&colon;none` is seen as `display:none`.
 */
export function decodeAttribute(value: string): string {
  return value
    .replace(/&#[xX]([0-9a-fA-F]+);?/g, (_, hex: string) => {
      const cp = parseInt(hex, 16)
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
    })
    .replace(/&#(\d+);?/g, (_, dec: string) => {
      const cp = Number(dec)
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
    })
    .replace(/&([a-zA-Z]+);/g, (whole, name: string) => NAMED_REFS[name.toLowerCase()] ?? whole)
}

/** Whether an opening tag's attributes keep it from rendering: `hidden`, or an inline style that hides it. */
function isHiddenTag(attrs: string): boolean {
  for (const m of attrs.matchAll(/([^\s"'=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    const name = (m[1] ?? "").toLowerCase()
    const value = decodeAttribute(m[2] ?? m[3] ?? m[4] ?? "")
    if (name === "hidden") return true
    if (name === "style" && /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden|mso-hide\s*:\s*all)\b/i.test(value)) {
      return true
    }
  }
  return false
}

/**
 * Drop markup a browser never renders - comments, <script>/<style>/<template>
 * blocks, and elements marked hidden - before tags are stripped. CSS-only
 * tricks (off-screen, zero font size) need a renderer and are not caught here.
 */
export function visibleHtml(html: string): string {
  const src = html
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .replace(/<(script|style|template)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, "")
  const open = new RegExp(`<([a-zA-Z][a-zA-Z0-9-]*)(\\s${ATTRS})?>`, "g")
  const kept: string[] = []
  let from = 0
  let m: RegExpExecArray | null
  while ((m = open.exec(src)) !== null) {
    if (!m[2] || !isHiddenTag(m[2])) continue
    const tag = (m[1] ?? "").toLowerCase()
    let end = open.lastIndex
    if (!VOID_TAGS.has(tag)) {
      // An unclosed hidden element runs to the end: failing closed drops
      // visible text, failing open would leak the hidden text.
      const same = new RegExp(`<(/?)([a-zA-Z][a-zA-Z0-9-]*)${ATTRS}>`, "g")
      same.lastIndex = end
      end = src.length
      let depth = 1
      let s: RegExpExecArray | null
      while ((s = same.exec(src)) !== null) {
        if ((s[2] ?? "").toLowerCase() !== tag) continue
        if (s[1]) depth--
        else depth++
        if (depth === 0) {
          end = same.lastIndex
          break
        }
      }
    }
    kept.push(src.slice(from, m.index))
    from = end
    open.lastIndex = end
  }
  kept.push(src.slice(from))
  return kept.join("")
}
