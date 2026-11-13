import { describe, expect, it } from "vitest";
import { isBlockedAddress } from "./ip-ranges";
import { SafeFetchError, assertSafeUrl, safeFetch } from "./safe-fetch";

describe("isBlockedAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254", // cloud metadata
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fe80::1",
    "fd00::1",
    "fc00::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1", // mapped loopback, hex form
    "::ffff:169.254.169.254",
    "64:ff9b::a9fe:a9fe", // NAT64 of metadata IP
    "2002:7f00:1::", // 6to4 of loopback
    "[::1]",
    "fe80::1%eth0",
    "not-an-ip",
  ])("blocks %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each(["93.184.215.14", "8.8.8.8", "172.32.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])(
    "allows public %s",
    (ip) => {
      expect(isBlockedAddress(ip)).toBe(false);
    },
  );
});

describe("assertSafeUrl", () => {
  const code = (url: string) => {
    try {
      assertSafeUrl(url);
      return "ok";
    } catch (e) {
      return (e as SafeFetchError).code;
    }
  };

  it("accepts public https URLs", () => {
    expect(code("https://api.example.com/openapi.json")).toBe("ok");
  });

  it("rejects http, junk, credentials and private hosts", () => {
    expect(code("http://api.example.com")).toBe("not_https");
    expect(code("file:///etc/passwd")).toBe("not_https");
    expect(code("not a url")).toBe("invalid_url");
    expect(code("https://user:pw@example.com")).toBe("invalid_url");
    expect(code("https://localhost/x")).toBe("blocked_address");
    expect(code("https://127.0.0.1/x")).toBe("blocked_address");
    expect(code("https://[::1]/x")).toBe("blocked_address");
    expect(code("https://169.254.169.254/latest/meta-data")).toBe("blocked_address");
    expect(code("https://metadata.internal/")).toBe("blocked_address");
  });
});

describe("safeFetch", () => {
  const failsWith = async (p: Promise<unknown>) => {
    try {
      await p;
      return "ok";
    } catch (e) {
      return e instanceof SafeFetchError ? e.code : `unexpected: ${String(e)}`;
    }
  };

  it("refuses a hostname that resolves to a private address, at connect time", async () => {
    const resolve = async () => [{ address: "10.0.0.5", family: 4 }];
    expect(await failsWith(safeFetch("https://rebind.example.com/", { resolve }))).toBe("blocked_address");
  });

  it("refuses a mixed public/private DNS answer", async () => {
    const resolve = async () => [
      { address: "93.184.215.14", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ];
    expect(await failsWith(safeFetch("https://mixed.example.com/", { resolve }))).toBe("blocked_address");
  });

  it("reports DNS failures plainly", async () => {
    const resolve = async () => {
      throw Object.assign(new Error("nope"), { code: "ENOTFOUND" });
    };
    expect(await failsWith(safeFetch("https://missing.example.com/", { resolve }))).toBe("dns_failed");
  });

  it("refuses non-https before touching the network", async () => {
    expect(await failsWith(safeFetch("http://example.com/"))).toBe("not_https");
  });
});
