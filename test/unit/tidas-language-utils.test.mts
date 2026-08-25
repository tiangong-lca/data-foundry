import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  TIDAS_LANGUAGE_CODES,
  TIDAS_LANGUAGE_CODE_SET,
  normalizeTidasLanguageCode,
  tidasLanguageForText,
} from "../../scripts/lib/tidas-language-utils.ts";

test("TIDAS language enumeration remains complete, unique, sorted, and stable", () => {
  assert.equal(TIDAS_LANGUAGE_CODES.length, 185);
  assert.equal(TIDAS_LANGUAGE_CODE_SET.size, 185);
  assert.deepEqual(TIDAS_LANGUAGE_CODES, [...TIDAS_LANGUAGE_CODES].sort());
  assert.equal(
    crypto.createHash("sha256").update(TIDAS_LANGUAGE_CODES.join(",")).digest("hex"),
    "51c1957a46cb12cad2d23e3748aa0f676a510c597c34b6c4dfc85b0af94addaa",
  );
  assert.ok(TIDAS_LANGUAGE_CODE_SET.has("en"));
  assert.ok(TIDAS_LANGUAGE_CODE_SET.has("zh"));
});

test("TIDAS language helpers accept enumerated language codes", () => {
  assert.equal(normalizeTidasLanguageCode("en"), "en");
  assert.equal(normalizeTidasLanguageCode("DE"), "de");
  assert.equal(normalizeTidasLanguageCode(" zh "), "zh");
});

test("TIDAS language helpers reject regional language tags", () => {
  assert.throws(() => normalizeTidasLanguageCode("zh-CN"), /TIDAS Languages enumeration value/u);
  assert.throws(() => normalizeTidasLanguageCode("en-US"), /TIDAS Languages enumeration value/u);
  assert.throws(
    () => normalizeTidasLanguageCode("xx", { field: "source_language" }),
    /source_language must use a TIDAS Languages enumeration value: xx/u,
  );
});

test("TIDAS language helpers detect Chinese source text as zh", () => {
  assert.equal(tidasLanguageForText("中文名称"), "zh");
  assert.equal(tidasLanguageForText("㐀 extension A"), "zh");
  assert.equal(tidasLanguageForText("﨑 compatibility"), "zh");
  assert.equal(tidasLanguageForText("German source text", "de"), "de");
});

test("TIDAS language helpers preserve empty-input and fallback normalization", () => {
  assert.equal(normalizeTidasLanguageCode(undefined, { fallback: "DE" }), "de");
  assert.equal(normalizeTidasLanguageCode(null, { fallback: "" }), "en");
  assert.equal(tidasLanguageForText("", "DE"), "de");
  assert.equal(tidasLanguageForText(null, "zh"), "zh");
  assert.throws(() => tidasLanguageForText("Latin text", "en-US"), /TIDAS Languages/u);
});
