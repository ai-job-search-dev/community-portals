import {
  stripInvisible,
  FEED_URL,
  normalizeSlug,
  parseFeed,
  textFetch,
  toDetail,
  writeError,
} from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

/**
 * Look a posting up in the feed. The board's terms forbid scraping its pages,
 * so the full description is not fetched: `description` is the feed summary,
 * and the posting URL is where a person (or /apply's own page read) gets the rest.
 */
export async function runDetail(opts: DetailOpts): Promise<number> {
  const slug = normalizeSlug(opts.id)
  if (!slug) {
    writeError(`Could not parse a Work With Indies posting slug from "${opts.id}"`, "BAD_ID")
    return 1
  }
  try {
    const card = parseFeed(await textFetch(FEED_URL)).find((c) => c.id === slug)
    if (!card) {
      writeError(
        "Not in the current feed (it holds the newest 100 postings). Open the posting URL to read it.",
        "NOT_FOUND",
      )
      return 1
    }
    const job = stripInvisible(toDetail(card))

    if (opts.format === "plain") {
      const lines = [
        job.title,
        `${job.company || "—"} · ${job.location || "—"}`,
        "",
        job.date ? `Posted: ${job.date}` : "",
        job.employmentType ? `Employment: ${job.employmentType}` : "",
        job.tags.length ? `Tags: ${job.tags.join(", ")}` : "",
        "",
        job.description || "(no summary)",
        "",
        "(Feed summary only. The full description is on the posting page.)",
        `URL: ${job.url}`,
      ].filter((l) => l !== "")
      process.stdout.write(lines.join("\n") + "\n")
    } else {
      process.stdout.write(JSON.stringify(job, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}
