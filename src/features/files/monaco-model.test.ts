import { describe, expect, test } from "bun:test";

import { diffModelUri, fileModelUri, pickLanguage, type LanguageDefinition } from "./monaco-model";

const LANGUAGES: LanguageDefinition[] = [
  { id: "typescript", extensions: [".ts", ".tsx", ".mts"] },
  { id: "json", extensions: [".json"], filenames: ["composer.lock"] },
  { id: "dockerfile", extensions: [".dockerfile"], filenames: ["Dockerfile"] },
  { id: "markdown", extensions: [".md"] },
  { id: "handlebars", extensions: [".hbs", ".page.hbs"] },
  { id: "plaintext" },
];

describe("fileModelUri", () => {
  test("builds file URIs that keep the drive letter and escape awkward characters", () => {
    expect(fileModelUri("C:/proj/src/a b#1.ts")).toBe("file:///C:/proj/src/a%20b%231.ts");
    expect(fileModelUri("/home/me/a.ts")).toBe("file:///home/me/a.ts");
  });
});

describe("diffModelUri", () => {
  test("is unique per change and side", () => {
    expect(diffModelUri("change-1", "original")).toBe("inmemory://flare-diff/change-1/original");
    expect(diffModelUri("change-1", "modified")).not.toBe(diffModelUri("change-2", "modified"));
  });
});

describe("pickLanguage", () => {
  test("matches by extension, case-insensitively", () => {
    expect(pickLanguage("C:/p/src/App.TSX", LANGUAGES)).toBe("typescript");
    expect(pickLanguage("C:/p/package.json", LANGUAGES)).toBe("json");
  });

  test("prefers exact file names over extensions", () => {
    expect(pickLanguage("C:/p/Dockerfile", LANGUAGES)).toBe("dockerfile");
    expect(pickLanguage("C:/p/composer.lock", LANGUAGES)).toBe("json");
  });

  test("prefers the longest extension that is registered", () => {
    expect(pickLanguage("C:/p/index.page.hbs", LANGUAGES)).toBe("handlebars");
    expect(pickLanguage("C:/p/a.test.ts", LANGUAGES)).toBe("typescript");
  });

  test("falls back to plaintext", () => {
    expect(pickLanguage("C:/p/LICENSE", LANGUAGES)).toBe("plaintext");
    expect(pickLanguage("C:/p/data.unknownext", LANGUAGES)).toBe("plaintext");
  });
});
