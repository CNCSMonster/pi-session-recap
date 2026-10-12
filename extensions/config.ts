/**
 * pi-session-recap - 配置加载与合并
 *
 * 纯 Node 实现（仅依赖 node:fs / node:path），不依赖 Pi 运行时，
 * 便于用 `node --test --experimental-strip-types` 独立测试。
 *
 * 配置文件（合并，项目优先）：
 * - ~/.pi/agent/extensions/session-recap.json (全局)
 * - <cwd>/.pi/session-recap.json (项目)
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface RecapConfig {
  /** 是否启用自动 recap（默认 true） */
  autoRecap: boolean;
  /** 自动 recap 的时间间隔（分钟，默认 50） */
  autoRecapIntervalMinutes: number;
}

export const DEFAULT_CONFIG: RecapConfig = {
  autoRecap: true,
  autoRecapIntervalMinutes: 50,
};

/** 配置文件名（全局与项目两处一致） */
export const CONFIG_FILE_NAME = "session-recap.json";

/** 项目级配置所在目录（Pi 约定） */
export const PROJECT_CONFIG_DIR = ".pi";

function readJsonFile(path: string): Partial<RecapConfig> {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (e) {
    console.error(`Warning: Could not parse ${path}: ${e}`);
    return {};
  }
}

/** 将候选配置收敛为合法的 RecapConfig，非法字段回落到默认值 */
export function normalizeConfig(candidate: Partial<RecapConfig>): Partial<RecapConfig> {
  const out: Partial<RecapConfig> = {};

  if (typeof candidate.autoRecap === "boolean") {
    out.autoRecap = candidate.autoRecap;
  }

  const interval = candidate.autoRecapIntervalMinutes;
  if (typeof interval === "number" && Number.isFinite(interval) && interval > 0) {
    out.autoRecapIntervalMinutes = Math.floor(interval);
  }

  return out;
}

/**
 * 加载配置：默认值 ← 全局配置 ← 项目配置（后者覆盖前者）
 *
 * @param cwd 项目工作目录
 * @param globalConfigPath 全局配置文件绝对路径
 */
export function loadConfig(cwd: string, globalConfigPath: string): RecapConfig {
  const projectConfigPath = join(cwd, PROJECT_CONFIG_DIR, CONFIG_FILE_NAME);

  const globalConfig = normalizeConfig(readJsonFile(globalConfigPath));
  const projectConfig = normalizeConfig(readJsonFile(projectConfigPath));

  return {
    ...DEFAULT_CONFIG,
    ...globalConfig,
    ...projectConfig,
  };
}
