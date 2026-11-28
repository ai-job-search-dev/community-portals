import { describe, expect, test } from "bun:test";
import { ROMANDIE_CANTONS, stripHighlight, toDetail, toSummary } from "../src/helpers";

// Fixtures are trimmed shapes of real job-room.ch API responses. No network.
const SEARCH_HIT = {
  jobAdvertisement: {
    id: "e75c4b4a-ff96-477c-908b-91fd6416fdfc",
    createdTime: "2026-10-14T08:21:33.512Z",
    status: "PUBLISHED_PUBLIC",
    sourceSystem: "API",
    publication: { startDate: "2026-10-14", endDate: "2026-11-14" },
    reportingObligation: true,
  reportingObligationEndDate: "2026-11-10",
  jobContent: {
      externalUrl: "https://www.jobup.ch/en/jobs/detail/123456/",
      location: { city: "Genève", cantonCode: "GE", postalCode: "1204" },
      // Strings, as the live API returns them (verified 11 November 2026).
      employment: { workloadPercentageMin: "80", workloadPercentageMax: "100", permanent: true },
      company: { name: "Banque &amp; Compagnie SA" },
      jobDescriptions: [
        { languageIsoCode: "fr", title: "Ingénieur <em>sécurité</em>", description: "Description FR" },
        { languageIsoCode: "en", title: "Security Engineer", description: "Description EN" },
      ],
    },
  },
};

describe("stripHighlight", () => {
  test("removes the <em> highlight tags the search API injects", () => {
    expect(stripHighlight("Ingénieur <em>sécurité</em>")).toBe("Ingénieur sécurité");
  });

  test("decodes named and numeric HTML entities", () => {
    expect(stripHighlight("Banque &amp; Cie &#39;SA&#39; &#x26; co")).toBe("Banque & Cie 'SA' & co");
  });

  test("passes null and undefined through as null", () => {
    expect(stripHighlight(null)).toBeNull();
    expect(stripHighlight(undefined)).toBeNull();
  });
});

describe("toSummary", () => {
  test("flattens a search hit envelope", () => {
    const summary = toSummary(SEARCH_HIT);

    expect(summary.id).toBe("e75c4b4a-ff96-477c-908b-91fd6416fdfc");
    expect(summary.title).toBe("Ingénieur sécurité");
    expect(summary.company).toBe("Banque & Compagnie SA");
    expect(summary.city).toBe("Genève");
    expect(summary.cantonCode).toBe("GE");
    expect(summary.workloadMin).toBe("80");
    expect(summary.workloadMax).toBe("100");
    expect(summary.permanent).toBe(true);
    expect(summary.onlineSince).toBe("2026-10-14");
    expect(summary.languageIsoCode).toBe("fr");
  });

  test("honours the preferred-language order", () => {
    expect(toSummary(SEARCH_HIT, ["en"]).title).toBe("Security Engineer");
    expect(toSummary(SEARCH_HIT, ["en"]).languageIsoCode).toBe("en");
  });

  test("falls back to the first description when no preferred language matches", () => {
    const summary = toSummary(SEARCH_HIT, ["it"]);

    expect(summary.languageIsoCode).toBe("fr");
  });

  test("surfaces the job registration requirement fields", () => {
    const summary = toSummary(SEARCH_HIT);

    expect(summary.reportingObligation).toBe(true);
    expect(summary.reportingObligationEndDate).toBe("2026-11-10");
  });

  test("reports an absent registration flag as null rather than false", () => {
    const summary = toSummary({ jobAdvertisement: { id: "bare" } });

    expect(summary.reportingObligation).toBeNull();
    expect(summary.reportingObligationEndDate).toBeNull();
  });

  test("records the syndication source so aggregated results can be deduped", () => {
    expect(toSummary(SEARCH_HIT).externalUrl).toContain("jobup.ch");
  });

  test("survives a hit with no job content", () => {
    const summary = toSummary({ jobAdvertisement: { id: "bare" } });

    expect(summary.id).toBe("bare");
    expect(summary.title).toBe("(untitled)");
    expect(summary.company).toBeNull();
    expect(summary.city).toBeNull();
  });
});

describe("toDetail", () => {
  test("adds the full description and keeps every language", () => {
    const detail = toDetail(SEARCH_HIT.jobAdvertisement);

    expect(detail.title).toBe("Ingénieur sécurité");
    expect(detail.description).toBe("Description FR");
    expect(detail.descriptionsByLanguage).toHaveLength(2);
    expect(detail.status).toBe("PUBLISHED_PUBLIC");
    expect(detail.sourceSystem).toBe("API");
  });

  test("defaults the collection fields rather than returning undefined", () => {
    const detail = toDetail({ id: "bare" });

    expect(detail.workForms).toEqual([]);
    expect(detail.descriptionsByLanguage).toEqual([]);
    expect(detail.applyChannel).toBeNull();
  });
});

describe("ROMANDIE_CANTONS", () => {
  test("covers the six French-speaking cantons", () => {
    expect(Object.keys(ROMANDIE_CANTONS).sort()).toEqual(["FR", "GE", "JU", "NE", "VD", "VS"]);
  });
});

describe("decodeHtmlEntities, through stripHighlight", () => {
  test("decodes each entity exactly once", () => {
    // Chained .replace() calls decoded &amp; first, so &amp;lt; became "<".
    expect(stripHighlight("&amp;lt;tag&amp;gt;")).toBe("&lt;tag&gt;");
  });

  test("decodes hex and decimal numeric entities", () => {
    expect(stripHighlight("&#x41;&#66;&#x63;")).toBe("ABc");
  });

  test("leaves an unknown entity untouched rather than dropping it", () => {
    expect(stripHighlight("Caf&eacute; &amp; bar")).toBe("Caf&eacute; & bar");
  });

  test("decodes non-breaking spaces to plain spaces", () => {
    expect(stripHighlight("Genève&nbsp;SA")).toBe("Genève SA");
  });
});

describe("entity decoding does not reach Object.prototype", () => {
  test("an inherited property name is left as literal text", () => {
    // NAMED_ENTITIES[body] on a plain object spliced function source text in.
    for (const name of ["constructor", "toString", "hasOwnProperty", "valueOf"]) {
      expect(stripHighlight(`&${name};`)).toBe(`&${name};`);
    }
  });
});
