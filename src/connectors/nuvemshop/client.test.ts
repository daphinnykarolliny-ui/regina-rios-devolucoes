import { describe, it, expect } from "vitest";
import { extractVariantAttributes } from "./client";

describe("extractVariantAttributes", () => {
  it("reads Cor and Tamanho regardless of case", () => {
    const result = extractVariantAttributes([
      { name: "Cor", value: "Preto" },
      { name: "TAMANHO", value: "37" },
    ]);
    expect(result).toEqual({ color: "Preto", size: "37" });
  });

  it("returns nulls when properties are missing", () => {
    expect(extractVariantAttributes([])).toEqual({ color: null, size: null });
  });
});
