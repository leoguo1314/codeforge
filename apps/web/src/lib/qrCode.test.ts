import { describe, expect, it } from "vitest";

import { createQrMatrix, qrMatrixToPath } from "./qrCode";

describe("offline pairing QR encoder", () => {
  it("creates a square version-1 matrix for a short byte payload", () => {
    const matrix = createQrMatrix("pair-me");
    expect(matrix.length).toBe(21);
    expect(matrix.every((row) => row.length === 21)).toBe(true);

    // Finder-pattern anchors remain present in all three required corners.
    expect(matrix[0][0]).toBe(true);
    expect(matrix[0][6]).toBe(true);
    expect(matrix[6][0]).toBe(true);
    expect(matrix[0][20]).toBe(true);
    expect(matrix[20][0]).toBe(true);
  });

  it("selects a larger QR version for credential-bearing pairing links", () => {
    const matrix = createQrMatrix(
      `codeforge://connect?server=${encodeURIComponent("https://codeforge.example.com")}&token=${"a".repeat(96)}`,
    );
    expect(matrix.length).toBeGreaterThan(21);
    expect((matrix.length - 17) % 4).toBe(0);
  });

  it("renders black modules as an SVG path with a quiet zone", () => {
    const matrix = createQrMatrix("pair-me");
    const rendered = qrMatrixToPath(matrix);
    expect(rendered.viewBoxSize).toBe(matrix.length + 8);
    expect(rendered.path.startsWith("M")).toBe(true);
  });

  it("rejects payloads beyond the built-in version-10 envelope", () => {
    expect(() => createQrMatrix("x".repeat(400))).toThrow(/too long/i);
  });
});
