import { describe, expect, it } from "vitest";

import { ANDROID_SHARE_PREFIX, parseAndroidSharedPayload } from "./androidBridge";

describe("parseAndroidSharedPayload", () => {
  it("normalizes ordinary shared text", () => {
    expect(parseAndroidSharedPayload("  https://example.com/path  ")).toEqual({
      kind: "text",
      text: "https://example.com/path",
    });
  });

  it("parses a versioned image payload and optional caption", () => {
    const encoded =
      ANDROID_SHARE_PREFIX +
      JSON.stringify({
        kind: "image",
        name: " screenshot.jpg ",
        mimeType: "image/jpeg",
        dataUrl: "data:image/jpeg;base64,ZmFrZQ==",
        text: " investigate this failure ",
      });

    expect(parseAndroidSharedPayload(encoded)).toEqual({
      kind: "image",
      name: "screenshot.jpg",
      mimeType: "image/jpeg",
      dataUrl: "data:image/jpeg;base64,ZmFrZQ==",
      text: "investigate this failure",
    });
  });

  it("rejects malformed or unsupported versioned payloads", () => {
    expect(parseAndroidSharedPayload(`${ANDROID_SHARE_PREFIX}{not-json`)).toBeNull();
    expect(
      parseAndroidSharedPayload(
        ANDROID_SHARE_PREFIX +
          JSON.stringify({
            kind: "image",
            name: "notes.txt",
            mimeType: "text/plain",
            dataUrl: "data:text/plain;base64,ZmFrZQ==",
          }),
      ),
    ).toBeNull();
    expect(
      parseAndroidSharedPayload(
        ANDROID_SHARE_PREFIX + JSON.stringify({ kind: "file", name: "archive.zip" }),
      ),
    ).toBeNull();
  });
});
