import {
  stripInvisible,
  FEED_URL,
  normalizeSlug,
  parseFeed,
  postingUrl,
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
    const feed = await textFetch(FEED_URL)
    if (!feed) {
      writeError(`The feed ${FEED_URL} is unavailable or empty (404 or no body), so the posting cannot be looked up`, "FEED_UNAVAILABLE")
      return 1
    }
    const card = stripInvisible(parseFeed(feed)).find((c) => c.id === slug)
    if (!card) {
      writeError(
        `Not in the current feed (it holds the newest 100 postings). Open the posting URL to read it: ${postingUrl(slug)}`,
        "NOT_FOUND",
      )
      return 1
    }
    const job = toDetail(card)

    if (opts.format === "plain") {
      const lines = [
        job.title,
        `${job.company || "—"} · ${job.location || "—"}`,
        "",
        job.date ? `Posted: ${job.date}` : null,
        job.employmentType ? `Employment: ${job.employmentType}` : null,
        job.tags.length ? `Tags: ${job.tags.join(", ")}` : null,
        "",
        job.description || "(no summary)",
        "",
        "(Feed summary only. The full description is on the posting page.)",
        `URL: ${job.url}`,
      ].filter((l): l is string => l !== null)
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
