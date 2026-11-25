// URL -> fixture file, exactly as the CLI requests them.
const B = "https://publicjobs.ch";
const data = (path: string) => `${B}${path}/__data.json?x-sveltekit-invalidated=01`;
export const CANONICAL_168023 = "/jobs/schwyz/informatik-it/168023-fachspezialist-statistiken-und-simulationen";

export const SITEMAP_ROUTE: Record<string, string> = { [`${B}/sitemap.xml`]: "sitemap-excerpt.xml" };

export const DETAIL_ROUTES: Record<string, string> = {
  [data("/jobs/x/x/168023")]: "redirect-168023.json",
  [data(CANONICAL_168023)]: "detail-168023.json",
  [data("/jobs/x/x/100")]: "expired.json",
};
