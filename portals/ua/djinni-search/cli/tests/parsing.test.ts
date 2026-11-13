import { describe, expect, test } from "bun:test";
import {
  detailTarget,
  englishLevel,
  normalizeCategory,
  normalizeRegion,
  parseJobDetail,
  parseSearchPage,
  parseTotal,
  suggestCategories,
} from "../src/helpers";
import { card, detailPage, ld, searchPage } from "./fixtures";

describe("parseSearchPage", () => {
  const page = searchPage(
    [
      card({ id: "900001", title: "Full-Stack Engineer (React, Node)", company: "Acme", location: "Країни Європи та Україна", english: "Англійська - B1", tier: "$$$" }),
      card({ id: "900002", title: "Frontend Developer &amp; Designer", company: "Beta Labs", location: "Україна", english: "Англійська - B2", salary: "до $6000" }),
    ],
    [
      ld({ id: 900001, title: "Full-Stack Engineer (React, Node)", company: "Acme", employmentType: "PART_TIME", months: 48 }),
      ld({ id: 900002, title: "Frontend Developer & Designer", company: "Beta Labs", remote: false, months: 18, category: "JavaScript" }),
    ],
    273,
  );

  test("parses every card with the contract fields", () => {
    const cards = parseSearchPage(page);
    expect(cards).toHaveLength(2);
    expect(cards[0]).toEqual({
      id: "900001",
      title: "Full-Stack Engineer (React, Node)",
      company: "Acme",
      location: "Країни Європи та Україна",
      url: "https://djinni.co/jobs/900001-test-role/",
      english: "B1",
      salary: null,
      salaryTier: "$$$",
      date: "2026-10-30",
      remoteOnly: true,
      offices: [],
      employmentType: "PART_TIME",
      experienceYears: 4,
      category: "Fullstack",
    });
  });

  test("decodes entities, reads a public salary, and lists offices for a non-remote-only posting", () => {
    const [, second] = parseSearchPage(page);
    expect(second.title).toBe("Frontend Developer & Designer");
    expect(second.salary).toBe("до $6000");
    expect(second.salaryTier).toBeNull();
    expect(second.remoteOnly).toBe(false);
    expect(second.offices).toEqual(["Польща", "Львів"]);
    expect(second.experienceYears).toBe(1.5);
    expect(second.english).toBe("B2");
  });

  test("reads the result total next to the heading", () => {
    expect(parseTotal(page)).toBe(273);
    expect(parseTotal("<html></html>")).toBeNull();
  });

  test("a card without a title is skipped and the rest still parse", () => {
    const broken = searchPage(
      [card({ id: "900003", title: "" }), card({ id: "900004", title: "QA Engineer", company: "Gamma" })],
      [],
    );
    const cards = parseSearchPage(broken);
    expect(cards.map((c) => c.id)).toEqual(["900004"]);
  });

  test("a missing company or location is null, never a neighbour's value", () => {
    const cards = parseSearchPage(searchPage([card({ id: "900005", title: "Dev" })], []));
    expect(cards[0].company).toBeNull();
    expect(cards[0].location).toBeNull();
  });

  test("malformed JSON-LD leaves the cards intact with null structured fields", () => {
    const cards = parseSearchPage(searchPage([card({ id: "900006", title: "Dev", company: "Acme" })], "[{not json"));
    expect(cards).toHaveLength(1);
    expect(cards[0].date).toBeNull();
    expect(cards[0].remoteOnly).toBeNull();
    expect(cards[0].offices).toEqual([]);
    expect(cards[0].category).toBeNull();
  });

  test("--jobage keeps fresh postings and drops old or undated ones", () => {
    const now = Date.parse("2026-10-30T18:00:00");
    const html = searchPage(
      [card({ id: "1001", title: "Fresh" }), card({ id: "1002", title: "Old" }), card({ id: "1003", title: "Undated" })],
      [
        ld({ id: 1001, title: "Fresh", datePosted: "2026-10-29T10:00:00" }),
        ld({ id: 1002, title: "Old", datePosted: "2026-10-01T10:00:00" }),
      ],
    );
    expect(parseSearchPage(html, { maxAgeDays: 7, now }).map((c) => c.title)).toEqual(["Fresh"]);
    expect(parseSearchPage(html, { now })).toHaveLength(3);
  });
});

describe("parseJobDetail", () => {
  test("reads header, sidebar and description with line breaks kept", () => {
    const html = detailPage({
      id: 900001,
      title: "Full-Stack Engineer",
      company: "Acme",
      descriptionHtml: "<p>We build&nbsp; &amp; ship.<br>&nbsp;<br>You have:</p><ul><li>Node.js</li><li>React</li></ul>",
    });
    const job = parseJobDetail(html, "900001", "https://djinni.co/jobs/900001-x/");
    expect(job).not.toBeNull();
    expect(job!.title).toBe("Full-Stack Engineer");
    expect(job!.company).toBe("Acme");
    expect(job!.location).toBe("Країни Європи та Україна");
    expect(job!.english).toBe("B1");
    expect(job!.languages).toEqual(["Англійська B1 – Середній", "Українська Носій мови"]);
    expect(job!.workplace).toBe("Тільки віддалено");
    expect(job!.salaryTier).toBe("$$$");
    expect(job!.url).toBe("https://djinni.co/jobs/900001-test-role/");
    expect(job!.date).toBe("2026-10-30");
    expect(job!.validThrough).toBe("2026-11-29");
    expect(job!.description).toBe("We build & ship.\n\nYou have:\nNode.js\nReact");
  });

  test("falls back to the JSON-LD description when the block is empty", () => {
    const html = detailPage({
      id: 900002,
      title: "Dev",
      company: "Acme",
      descriptionHtml: "",
      postings: [ld({ id: 900002, title: "Dev", description: "Line one\n\n\n\nLine two" })],
    });
    expect(parseJobDetail(html, "900002", "u")!.description).toBe("Line one\n\nLine two");
  });

  test("keeps plain-text line breaks in the JSON-LD description fallback", () => {
    const html = detailPage({
      id: 900002,
      title: "Dev",
      company: "Acme",
      descriptionHtml: "",
      // As on the live site: tag-free text, a raw &, \n line breaks.
      postings: [ld({ id: 900002, title: "Dev", description: "About us\n \nC++ < 3 & Go\nYou have:" })],
    });
    expect(parseJobDetail(html, "900002", "u")!.description).toBe("About us\n\nC++ < 3 & Go\nYou have:");
  });

  test("falls back to the JSON-LD description when the page has no description block", () => {
    const html = detailPage({
      id: 900006,
      title: "Dev",
      company: "Acme",
      descriptionHtml: "<p>Not in a description block</p>",
      postings: [ld({ id: 900006, title: "Dev", description: "From JSON-LD" })],
    }).replace("job-post__description", "");
    expect(parseJobDetail(html, "900006", "u")!.description).toBe("From JSON-LD");
  });

  test("picks the posting with the requested id when it is not the first", () => {
    const postings = JSON.stringify([ld({ id: 111111, title: "Other", company: "Other Co" }), ld({ id: 900005, title: "Dev", company: "Acme" })]);
    const html = detailPage({ id: 900005, title: "", company: "", descriptionHtml: "<p>Body</p>", postings });
    const job = parseJobDetail(html, "900005", "u")!;
    expect(job.title).toBe("Dev");
    expect(job.company).toBe("Acme");
    expect(job.url).toBe("https://djinni.co/jobs/900005-test-role/");
  });

  test("a page whose JSON-LD holds only other postings is not this posting", () => {
    const html = detailPage({ id: 111111, title: "Other Role", company: "Other", descriptionHtml: "<p>Other</p>" });
    expect(parseJobDetail(html, "855979", "u")).toBeNull();
  });

  test("a page with a description block but no JSON-LD posting still parses", () => {
    const html = detailPage({ id: 900004, title: "Dev", company: "Acme", descriptionHtml: "<p>Body</p>", postings: "[]" });
    expect(parseJobDetail(html, "900004", "u")!.description).toBe("Body");
  });

  test("a page with neither JSON-LD nor a description block is not a posting", () => {
    expect(parseJobDetail("<html><h1>Вакансії</h1></html>", "1", "u")).toBeNull();
  });

  test("ignores a JSON-LD url that points off djinni.co", () => {
    const posting = { ...ld({ id: 900003, title: "Dev" }), url: "https://evil.example/jobs/1/" };
    const html = detailPage({ id: 900003, title: "Dev", company: "Acme", descriptionHtml: "<p>x</p>", postings: [posting] });
    expect(parseJobDetail(html, "900003", "https://djinni.co/jobs/900003-x/")!.url).toBe("https://djinni.co/jobs/900003-x/");
  });
});

describe("input normalization", () => {
  test("detailTarget accepts ids, slugs and djinni.co URLs only", () => {
    expect(detailTarget("855979")).toEqual({ id: "855979", path: "/jobs/855979-x/" });
    expect(detailTarget("855979-full-stack-engineer")).toEqual({ id: "855979", path: "/jobs/855979-full-stack-engineer/" });
    expect(detailTarget("https://djinni.co/jobs/855979-full-stack-engineer/?applied=ok")).toEqual({
      id: "855979",
      path: "/jobs/855979-full-stack-engineer/",
    });
    expect(detailTarget("djinni.co/jobs/855979/")).toEqual({ id: "855979", path: "/jobs/855979-x/" });
    expect(detailTarget("https://jobs.ashbyhq.com/acme/855979")).toBeNull();
    expect(detailTarget("https://djinni.co.evil.io/jobs/855979-x/")).toBeNull();
    expect(detailTarget("https://djinni.co@evil.io/jobs/855979-x/")).toBeNull();
    expect(detailTarget("https://djinni.co/developers/855979/")).toBeNull();
    expect(detailTarget("not an id")).toBeNull();
  });

  test("categories match case-insensitively and suggest close names", () => {
    expect(normalizeCategory("react.js")).toBe("React.js");
    expect(normalizeCategory("fullstack")).toBe("Fullstack");
    expect(normalizeCategory("React")).toBeNull();
    expect(suggestCategories("React")).toEqual(["React.js", "React Native"]);
  });

  test("regions and English labels", () => {
    expect(normalizeRegion("Ukraine")).toBe("UKR");
    expect(normalizeRegion("europe")).toBe("eu");
    expect(normalizeRegion("mars")).toBeNull();
    expect(englishLevel("Англійська - B2")).toBe("B2");
    expect(englishLevel("Англійська B1 – Середній")).toBe("B1");
    expect(englishLevel("4 роки досвіду")).toBeNull();
  });
});