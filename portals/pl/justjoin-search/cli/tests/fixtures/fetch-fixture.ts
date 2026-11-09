// Preloaded into the CLI child process so tests run end to end with no network.
// Any request outside justjoin.it's /job-offers pages throws, so a stray request
// fails the test instead of reaching the internet.
const offer = {
  applyUrl: null,
  body: "$5b",
  city: "Opole",
  companyName: "BitBag",
  employmentTypes: [{ from: 8000, to: 12000, currency: "PLN", currencySource: "original", type: "b2b", unit: "month", gross: false }],
  experienceLevel: "mid",
  publishedAt: new Date().toISOString(),
  expiredAt: "2999-01-01T00:00:00Z",
  requiredSkills: ["Symfony", "PHP"],
  slug: "bitbag-mid-symfony-developer-opole-php",
  title: "Mid Symfony Developer",
  workplaceType: "remote",
}

const html = `<script>self.__next_f.push([1,${JSON.stringify(JSON.stringify(offer))}])</script>`

globalThis.fetch = (async (input: string | URL | Request) => {
  const url = new URL(input instanceof Request ? input.url : String(input))
  if (url.origin !== "https://justjoin.it" || !url.pathname.startsWith("/job-offers")) {
    throw new Error(`Unexpected request in offline fixture: ${url}`)
  }
  return new Response(html)
}) as unknown as typeof fetch
