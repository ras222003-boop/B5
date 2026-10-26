import test from "node:test";
import assert from "node:assert/strict";
import { isLocalPrivateUrl } from "./phone-preflight.mjs";

test("preflight accepts exact loopback and RFC1918 IPv4 origins", () => {
  for (const url of [
    "http://127.0.0.1:4350",
    "https://localhost:4329",
    "https://[::1]:4329",
    "https://10.0.1.2",
    "https://172.16.0.1",
    "https://172.31.255.254",
    "https://192.168.1.98",
  ])
    assert.equal(isLocalPrivateUrl(url), true, url);
});
test("lookalike DNS hosts do not pass the private-IP rule", () => {
  for (const url of [
    "https://10.evil.example",
    "https://192.168.evil.example",
    "https://172.16.1.1.evil.example",
    "https://localhost.evil.example",
  ])
    assert.equal(isLocalPrivateUrl(url), false, url);
});
test("preflight rejects public ranges and non-web protocols", () => {
  for (const url of [
    "https://8.8.8.8",
    "https://172.15.0.1",
    "https://172.32.0.1",
    "file:///tmp/test",
    "ftp://127.0.0.1",
    "invalid",
  ])
    assert.equal(isLocalPrivateUrl(url), false, url);
});
test("userinfo is not accepted into evidence URLs", () => {
  assert.equal(isLocalPrivateUrl("https://user:secret@127.0.0.1"), false);
});
