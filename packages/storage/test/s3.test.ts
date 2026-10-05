import { describe, expect, it } from "vitest";
import { S3FileStore } from "../src/s3";

// the worked example of the AWS documentation ("Authenticating Requests: Using Query Parameters")
const aws = new S3FileStore({ endpoint: "https://s3.amazonaws.com", region: "us-east-1", bucket: "examplebucket", accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", pathStyle: false });

describe("S3 signing", () => {
  it("presigns a GET exactly as the AWS example", () => {
    const url = aws.signedUrl("test.txt", 86400, new Date("2013-05-24T00:00:00Z"));
    expect(url).toBe(
      "https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
    );
  });

  it("stores with server-side encryption under a signed request", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const store = new S3FileStore({ endpoint: "https://s3.eu.example", region: "eu-central-1", bucket: "hs-files", accessKeyId: "AK", secretAccessKey: "SK", pathStyle: true }, (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(null, { status: 200 });
    }) as typeof fetch);
    await store.put("t1/issue_photo/x", new Uint8Array([1, 2]), "image/jpeg");
    const h = calls[0]!.init.headers as Record<string, string>;
    expect(calls[0]!.url).toBe("https://s3.eu.example/hs-files/t1/issue_photo/x");
    expect(h["x-amz-server-side-encryption"]).toBe("AES256");
    expect(h.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AK\/\d{8}\/eu-central-1\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date;x-amz-server-side-encryption, Signature=[0-9a-f]{64}$/);
  });
});
