import { describe, expect, test } from "bun:test";

import { countRoles, dominantRole, roleOf } from "./roles";

describe("roleOf", () => {
  test("recognises tests by folder and by file name", () => {
    expect(roleOf("tests/cart.ts")).toBe("tests");
    expect(roleOf("src/lib/cart.test.ts")).toBe("tests");
    expect(roleOf("src/lib/cart_spec.py")).toBe("tests");
    expect(roleOf("pkg/test_cart.py")).toBe("tests");
  });

  test("recognises configuration files", () => {
    expect(roleOf("vite.config.ts")).toBe("config");
    expect(roleOf("tsconfig.base.ts")).toBe("config");
    expect(roleOf("scripts/release.js")).toBe("config");
  });

  test("recognises database, api and frontend folders", () => {
    expect(roleOf("src/db/client.ts")).toBe("database");
    expect(roleOf("migrations/001_init.py")).toBe("database");
    expect(roleOf("src/app/api/checkout/route.ts")).toBe("api");
    expect(roleOf("server/services/cart.ts")).toBe("api");
    expect(roleOf("src/components/Cart.tsx")).toBe("frontend");
    expect(roleOf("src/hooks/use-cart.ts")).toBe("frontend");
  });

  test("falls back to the extension, then to code", () => {
    expect(roleOf("src/lib/Widget.tsx")).toBe("frontend");
    expect(roleOf("src/lib/cart.ts")).toBe("code");
    expect(roleOf("native/src/lib.rs")).toBe("code");
  });

  test("tests win over every other signal", () => {
    expect(roleOf("src/components/Cart.test.tsx")).toBe("tests");
    expect(roleOf("src/db/__tests__/client.ts")).toBe("tests");
  });

  test("ignores case", () => {
    expect(roleOf("SRC/Components/Cart.TSX")).toBe("frontend");
  });
});

describe("role aggregation", () => {
  test("counts every role", () => {
    const counts = countRoles(["code", "code", "tests"]);
    expect(counts.code).toBe(2);
    expect(counts.tests).toBe(1);
    expect(counts.api).toBe(0);
  });

  test("picks the most common role and breaks ties by role order", () => {
    expect(dominantRole(["code", "code", "tests"])).toBe("code");
    expect(dominantRole(["tests", "frontend"])).toBe("frontend");
    expect(dominantRole([])).toBe("code");
  });
});
