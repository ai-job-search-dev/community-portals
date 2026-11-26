import { describe, expect, test } from "bun:test"
import { cleanHtml, visibleHtml } from "../src/helpers"

// Posting HTML is third-party input, so the tag regexes must stay linear on
// adversarial markup. Each case here used to take seconds: a run of `x= `
// attributes backtracked exponentially, and a long unclosed tail made every
// `<` rescan the rest of the input. The budget is generous so a slow CI runner
// does not flake; the fixed code takes a few milliseconds. Each case also pins
// cleanHtml's output, so a change that keeps the speed but changes what is
// kept still fails.

const BUDGET_MS = 500

function timed(fn: () => unknown): number {
  const start = performance.now()
  fn()
  return performance.now() - start
}

describe("tag regexes stay fast on adversarial HTML", () => {
  test.each<[string, string, string | null]>([
    ["40 empty-valued attributes", "<div " + "x= ".repeat(40), null],
    ["40 empty-valued attributes, closed", "<div " + "x= ".repeat(40) + ">text", "text"],
    ["20,000 empty-valued attributes", "<div " + "x= ".repeat(20_000) + ">text", "text"],
    ["50 KB of unclosed tags", "<a ".repeat(17_000), null],
    ["50 KB of unclosed tags with attributes", "<a x ".repeat(10_000), null],
    ["50 KB of unclosed tags ending in >", "<a ".repeat(17_000) + ">", null],
    ["50 KB of unbalanced quotes", "<p a=\"" + "x'".repeat(25_000) + ">", null],
    ["100 KB of unclosed <li", "<li ".repeat(25_000), null],
    ["100 KB of unclosed <script", "<script x".repeat(12_000), null],
    ["100 KB of unclosed <template", "<template ".repeat(10_000), null],
    ["100 KB of unclosed comments", "<!-- x".repeat(17_000), null],
    ["100 KB style of string-opening /*", '<p style="' + "'/*".repeat(33_000) + '">x</p>', "x"],
    ["100 KB style of url(/*", '<p style="' + "url(/*".repeat(16_000) + '">x</p>', "x"],
    ["50 KB style of backslashes", '<p style="\'' + "\\".repeat(50_000) + '">x</p>', "x"],
    ["100 KB style of CSS escapes", '<p style="' + "\\6e ".repeat(25_000) + '">x</p>', "x"],
    ["100 KB style of unterminated strings ending in a backslash", '<p style="' + "&quot;\\".repeat(14_000) + '">x</p>', "x"],
    ["100 KB style of escaped quotes ending in a backslash", '<p style="' + '\\"'.repeat(50_000) + '\\">x</p>', "x"],
    ["100 KB style of single-quoted runs ending in a backslash", "<p style=\"" + "'\\".repeat(50_000) + "\">x</p>", "x"],
    ["100 KB of list items with quoted > (single quotes)", "<ul>" + "<li '>'".repeat(14_000) + "' ></ul>", "- '\n".repeat(13_999) + "- '' >"],
    ["100 KB of list items with quoted > (double quotes)", "<ul>" + '<li ">"'.repeat(14_000) + '" ></ul>', '- "\n'.repeat(13_999) + '- "" >'],
    ["100 KB quoted value left unclosed", '<p>Visible</p><img alt="' + "x>".repeat(50_000), "Visible"],
    ["100 KB of attributes before an unclosed quote", "<p>Visible</p><a " + "x ".repeat(50_000) + 'y="z>w', "Visible"],
    ["long tag name and attributes before an unclosed quote", "<p>V</p><" + "a".repeat(30_000) + " x".repeat(30_000) + ' y="z>', "V"],
    ["long tag name and attributes with no >", "<p>V</p><" + "a".repeat(30_000) + " x".repeat(30_000), "V"],
    // A single alternation of the tag patterns was linear up to ~500 KB and
    // then took over a minute here, so this case is well past that size.
    ["640 KB of unclosed <li", "<li ".repeat(160_000), null],
  ])("%s", (_name, html, expected) => {
    expect(timed(() => cleanHtml(html))).toBeLessThan(BUDGET_MS)
    expect(timed(() => visibleHtml(html))).toBeLessThan(BUDGET_MS)
    expect(cleanHtml(html)).toBe(expected)
  })

  test("a run of empty-valued attributes is still parsed as one tag", () => {
    expect(cleanHtml("<div " + "x= ".repeat(40) + "hidden>secret</div><p>Visible</p>")).toBe("Visible")
  })
})
