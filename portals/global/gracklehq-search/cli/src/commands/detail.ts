import { stripInvisible, BASE_URL, normalizeId, resolveRedirect, writeError } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

/**
 * Grackle hosts no posting text: /rd/<id> is a redirect to the employer's own
 * page. `detail` resolves it (one request, never followed) and returns where
 * the posting lives, so the caller fetches it with the right tool.
 */
export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizeId(opts.id)
  if (!id) {
    writeError(`Could not parse a Grackle HQ job id from "${opts.id}"`, "BAD_ID")
    return 1
  }
  try {
    const url = `${BASE_URL}/rd/${id}`
    const target = await resolveRedirect(url)
    if (!target) {
      writeError("Job not found (Grackle removes postings that are no longer on the careers page)", "NOT_FOUND")
      return 1
    }
    let host: string | null = null
    try {
      host = new URL(target).hostname
    } catch {
      host = null
    }
    const job = stripInvisible({
      id,
      url,
      postingUrl: target,
      postingHost: host,
      description: null as string | null,
      isActive: true,
    })
    if (opts.format === "plain") {
      process.stdout.write(
        [
          `Grackle HQ job ${id}`,
          `Posting: ${job.postingUrl}`,
          `Host: ${job.postingHost ?? "—"}`,
          "Status: ACTIVE (still listed on Grackle)",
          "",
          "Grackle hosts no description. Fetch the posting URL above for the full text.",
        ].join("\n") + "\n",
      )
    } else {
      process.stdout.write(JSON.stringify(job, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}
