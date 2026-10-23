import { describe, expect, it } from "vitest";
import { parseGeneratedAnalysis } from "./analysis";

describe("parseGeneratedAnalysis", () => {
  it("renders product context and sanitises competitors", () => {
    const result = parseGeneratedAnalysis({
      product: {
        what: "Observability for jobs.",
        users: "Backend teams.",
        features: ["Alerts", "Retries"],
        planned: ["SAML (issue #7)"],
      },
      competitors: [
        { name: "Acme", aliases: ["acme"], reason: "Same job." },
        { name: "acme", aliases: [], reason: "duplicate" },
        { name: "Beta", aliases: ["B"], reason: "Substitute." },
      ],
    });
    expect(result.productContext).toContain("What it is: Observability for jobs.");
    expect(result.productContext).toContain("- SAML (issue #7)");
    expect(result.competitors).toHaveLength(2);
    expect(result.competitors[0].aliases).toEqual([]);
    expect(result.competitors[1].name).toBe("Beta");
  });

  it("rejects an incomplete analysis", () => {
    expect(() => parseGeneratedAnalysis({ competitors: [] })).toThrow(/incomplete/);
  });
});
