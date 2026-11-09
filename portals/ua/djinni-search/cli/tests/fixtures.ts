// Synthetic pages that mirror the structure of Djinni's live markup (captured
// 2026-10-30): the same class names, nesting and JSON-LD shape, with made-up
// postings instead of real third-party listing text.

export interface CardOpts {
  id: string;
  title: string;
  slug?: string;
  company?: string;
  location?: string;
  english?: string;
  salary?: string;
  tier?: string;
}

export function card(o: CardOpts): string {
  const pay = o.salary
    ? `<strong class="text-success text-nowrap small"><span class="text-success text-nowrap">
        ${o.salary}
      </span>
      </strong>`
    : o.tier
      ? `<span class="text-body-tertiary fw-medium"
          data-bs-toggle="tooltip"
          title="Рівень зарплати відносно інших вакансій: $ — нижче середнього, $$$$ — найвищий"
        >${o.tier}</span>`
      : "";
  return `<div id="job-item-${o.id}" class="job-item card-link fs-5 mb-4 rounded-2 p-2"
  >
    <div class="d-flex flex-column gap-1">
      <a href="/jobs/${o.id}-${o.slug ?? "test-role"}/"
        class="job_item__header-link d-flex flex-column gap-1 text-decoration-none"
      >
  <header class="row gx-2 align-items-start">
    <div class="col">
      <h2 class="job-item__position fs-4 m-0 mb-1">${o.title}</h2>
      <div class="d-flex flex-wrap align-items-center column-gap-1">
        ${o.company !== undefined ? `<span class="small text-gray-800 opacity-75 font-weight-500">${o.company}</span>` : ""}
      </div>
    </div>
    <div class="col-auto">
      <div class="fs-5">
        ${pay}
      </div>
    </div>
  </header>
      </a>
  <div class="fw-medium d-flex flex-wrap align-items-center column-gap-1">
      <span class="text-nowrap">Тільки віддалено</span>
      <span class="middot"> · </span>
    <span>
      ${o.location !== undefined ? `<span class="location-text">${o.location}</span>` : ""}
    </span>
      <span class="middot"> · </span>
      <span class="text-nowrap">4 роки досвіду</span>
      ${o.english ? `<span class="middot"> · </span><span class="text-nowrap">${o.english}</span>` : ""}
  </div>
  <div id="job-description-${o.id}">
    <span class="js-truncated-text">Teaser text with <span class="location-text">TEASER LOCATION</span>... </span>
  </div>
    </div>
  </div>`;
}

export interface LdOpts {
  id: number;
  title: string;
  company?: string;
  datePosted?: string;
  remote?: boolean;
  employmentType?: string;
  months?: number;
  category?: string;
  description?: string;
  slug?: string;
}

export function ld(o: LdOpts): Record<string, unknown> {
  return {
    "@context": "https://schema.org/",
    "@type": "JobPosting",
    category: o.category ?? "Fullstack",
    datePosted: o.datePosted ?? "2026-10-30T14:19:11.367967",
    description: o.description ?? "Structured description.",
    directApply: true,
    employmentType: o.employmentType ?? "FULL_TIME",
    experienceRequirements: { "@type": "OccupationalExperienceRequirements", monthsOfExperience: o.months ?? 48.0 },
    hiringOrganization: { "@type": "Organization", name: o.company ?? "Acme" },
    identifier: o.id,
    ...(o.remote === false
      ? {
          jobLocation: [
            { "@type": "Place", address: { "@type": "PostalAddress", addressCountry: "Польща", addressLocality: [] } },
            { "@type": "Place", address: { "@type": "PostalAddress", addressCountry: "Україна", addressLocality: ["Львів"] } },
          ],
        }
      : { jobLocationType: "TELECOMMUTE" }),
    title: o.title,
    url: `https://djinni.co/jobs/${o.id}-${o.slug ?? "test-role"}/`,
    validThrough: "2026-11-29T14:19:11.367967",
  };
}

export function searchPage(cards: string[], postings: unknown[] | string, total = 42): string {
  const json = typeof postings === "string" ? postings : JSON.stringify(postings);
  return `<!doctype html><html lang="uk"><head>
<script type="application/ld+json">
      ${json}
</script></head><body>
<header class="mb-4">
  <div class="d-flex align-items-baseline gap-2">
    <h1 class="mb-0">
      Вакансії на Djinni
    </h1>
    <span class="fs-1 fw-bold text-muted" style="line-height:1.2;">${total}</span>
  </div>
</header>
<main id="jobs_main">
  <ul class="list-unstyled list-jobs mb-4">
${cards.join("\n")}
  </ul>
</main>
<footer><span class="location-text">FOOTER LOCATION</span></footer>
</body></html>`;
}

export interface DetailOpts {
  id: number;
  title: string;
  company: string;
  descriptionHtml: string;
  postings?: unknown[] | string;
  tier?: string;
  english?: string;
  location?: string;
}

export function detailPage(o: DetailOpts): string {
  const postings = o.postings ?? [ld({ id: o.id, title: o.title, company: o.company })];
  const json = typeof postings === "string" ? postings : JSON.stringify(Array.isArray(postings) ? postings[0] : postings);
  return `<!doctype html><html lang="uk"><head>
<script type="application/ld+json">${json}</script></head><body>
<div class="container job-post-page">
  <header>
    <div class="row">
      <div class="col">
              <h1 class="m-0 mb-1 fs-2">
                ${o.title}
              </h1>
              <div class="d-flex flex-wrap align-items-center column-gap-1">
                   <a
                    href="https://djinni.co/jobs/company-${o.company.toLowerCase()}/"
                    class="text-secondary fw-medium"
                  >
                    ${o.company}
                  </a>
              </div>
      </div>
      <div class="col-auto">
        <div class="fs-3 fw-bold">
    <span class="text-body-tertiary fw-medium" data-bs-toggle="tooltip" title="Рівень зарплати">${o.tier ?? "$$$"}</span>
        </div>
      </div>
    </div>
  </header>
  <div class="row">
    <div class="col-lg-8 order-lg-0 order-1">
      <div class="mb-4 job-post__description">
        ${o.descriptionHtml}
      </div>
    </div>
    <div class="col-lg-4 order-lg-1 order-0 mb-4 mb-lg-0">
<aside>
    <div class="card card-body">
  <ul class="list-unstyled list-mb-3 font-size-small mb-0">
    <li><div><strong class="font-weight-600 capitalize-first-letter">Виключно від 4 років досвіду</strong></div></li>
    <li><strong class="d-block font-weight-600">Тільки віддалено</strong></li>
    <li>
  <strong class="d-block font-weight-600">
    <span class="location-text">${o.location ?? "Країни Європи та Україна"}</span>
</strong>
      <div class="font-size-extra-small">Країни, де розглядаємо кандидатів</div>
    </li>
    <li><ul class="list-unstyled"><li><div>
      <strong class="font-weight-600 capitalize-first-letter">
        ${o.english ?? "Англійська B1 – Середній"}
      </strong>
    </div></li><li><div>
      <strong class="font-weight-600 capitalize-first-letter">Українська Носій мови</strong>
    </div></li></ul></li>
    <li><strong class="d-block font-weight-600">Fullstack</strong></li>
  </ul>
    </div>
</aside>
    </div>
  </div>
</div>
</body></html>`;
}