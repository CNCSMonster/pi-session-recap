import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  DEFAULT_CONFIG,
  normalizeConfig,
  loadConfig,
  CONFIG_FILE_NAME,
  PROJECT_CONFIG_DIR,
} from "../extensions/config.ts";

function makeTempRoot(): string {
  return mkdtempSync(join(tmpdir(), "pi-session-recap-test-"));
}

test("DEFAULT_CONFIG has sane values", () => {
  assert.equal(DEFAULT_CONFIG.autoRecap, true);
  assert.equal(DEFAULT_CONFIG.autoRecapIntervalMinutes, 50);
});

test("normalizeConfig keeps valid fields and drops invalid ones", () => {
  const out = normalizeConfig({
    autoRecap: false,
    autoRecapIntervalMinutes: 30,
  });
  assert.deepEqual(out, { autoRecap: false, autoRecapIntervalMinutes: 30 });

  assert.deepEqual(normalizeConfig({ autoRecap: "yes" as unknown as boolean }), {});
  assert.deepEqual(normalizeConfig({ autoRecapIntervalMinutes: -5 }), {});
  assert.deepEqual(normalizeConfig({ autoRecapIntervalMinutes: NaN }), {});
  assert.deepEqual(normalizeConfig({ autoRecapIntervalMinutes: 12.7 }), {
    autoRecapIntervalMinutes: 12,
  });
  assert.deepEqual(normalizeConfig({}), {});
});

test("loadConfig with no files returns defaults", () => {
  const root = makeTempRoot();
  try {
    const config = loadConfig(root, join(root, "no-such-global.json"));
    assert.deepEqual(config, DEFAULT_CONFIG);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("global config overrides defaults", () => {
  const root = makeTempRoot();
  try {
    const globalPath = join(root, "global.json");
    writeFileSync(globalPath, JSON.stringify({ autoRecapIntervalMinutes: 90 }));
    const config = loadConfig(root, globalPath);
    assert.equal(config.autoRecapIntervalMinutes, 90);
    assert.equal(config.autoRecap, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("project config overrides global config", () => {
  const root = makeTempRoot();
  try {
    const globalPath = join(root, "global.json");
    writeFileSync(globalPath, JSON.stringify({ autoRecapIntervalMinutes: 90 }));

    const projectDir = join(root, PROJECT_CONFIG_DIR);
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, CONFIG_FILE_NAME),
      JSON.stringify({ autoRecap: false, autoRecapIntervalMinutes: 20 })
    );

    const config = loadConfig(root, globalPath);
    assert.equal(config.autoRecap, false);
    assert.equal(config.autoRecapIntervalMinutes, 20);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("malformed JSON falls back to defaults without throwing", () => {
  const root = makeTempRoot();
  try {
    const globalPath = join(root, "global.json");
    writeFileSync(globalPath, "{ not valid json");
    const config = loadConfig(root, globalPath);
    assert.deepEqual(config, DEFAULT_CONFIG);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
