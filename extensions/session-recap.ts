/**
 * pi-session-recap - 会话回忆扩展
 *
 * 核心设计：
 * 1. 复用 prompt cache：不改 system prompt，在对话末尾追加引导消息
 * 2. 利用已有 compaction summary：取完整分支上下文，而非只取最后 N 条
 * 3. 不写入历史：recap 是 side-query，结果不进对话条目
 * 4. 驱动方式：末尾 user message 引导，而非改 system prompt
 *
 * 触发方式：
 * 1. 手动：/recap 命令
 * 2. 自动：会话开始后持续超过 autoRecapIntervalMinutes（默认 50 分钟），
 *    在下一次 turn_end 时自动触发一次
 *
 * 配置文件（合并，项目优先）：
 * - ~/.pi/agent/extensions/session-recap.json (全局)
 * - <cwd>/.pi/session-recap.json (项目)
 */

import { join } from "node:path";
import { uuidv7 } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  serializeConversation,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { loadConfig, CONFIG_FILE_NAME, DEFAULT_CONFIG, type RecapConfig } from "./config.ts";

// ============================================================================
// 状态（会话内存态，不持久化）
// ============================================================================

/** 上次 recap 的时间戳（会话开始时初始化） */
let lastRecapAt: number = 0;

/** 是否正在生成 recap（防止手动/自动并发重复触发） */
let recapInProgress = false;

/** 当前生效配置（session_start 时从文件加载） */
let currentConfig: RecapConfig = { ...DEFAULT_CONFIG };

// ============================================================================
// 核心函数：生成 Recap
// ============================================================================

async function generateRecap(ctx: ExtensionCommandContext): Promise<string | null> {
  const branch = ctx.sessionManager.getBranch();

  // 1. 只有刚进入会话（历史为空）才不值得 recap，其余任何时候都支持
  const messageEntries = branch.filter(
    (e) => e.type === "message" && (e.message?.role === "user" || e.message?.role === "assistant")
  );
  if (messageEntries.length === 0) {
    return "__EMPTY_SESSION__";
  }

  // 2. 取 compaction 感知的完整模型上下文（含 summary，与模型实际所见一致）
  const projection = ctx.sessionManager.buildSessionProjection();
  const conversationText = serializeConversation(projection.messages);
  if (!conversationText.trim()) {
    return null;
  }

  // 3. 末尾追加引导消息（system prompt 不动，前缀可复用 prompt cache）
  const recapPrompt = `请用 2-3 句话总结一下这个对话的内容，帮我快速回忆：
- 大目标是什么
- 完成了什么
- 还在做什么（如果有未完成的）
- 最后几轮在干嘛

要求：
- 简洁，总共不超过 100 字
- 不要 markdown 格式
- 直接说内容，不要说"这个对话在..."

<conversation>
${conversationText}
</conversation>`;

  const recapMessages = [
    {
      role: "user" as const,
      content: [{ type: "text" as const, text: recapPrompt }],
      timestamp: Date.now(),
    },
  ];

  // 4. 逐个候选检查「存在且已认证」，全部不可用时兑底当前会话模型
  const candidates = [
    ctx.modelRegistry.find("google", "gemini-2.5-flash"),
    ctx.modelRegistry.find("openai", "gpt-4.1-mini"),
    ctx.modelRegistry.find("anthropic", "claude-3-5-haiku-20241022"),
  ];
  const model = candidates.find((m) => m && ctx.modelRegistry.hasConfiguredAuth(m)) ?? ctx.model;

  if (!model) {
    ctx.ui.notify("No model available for recap", "warning");
    return null;
  }
  if (!ctx.modelRegistry.hasConfiguredAuth(model)) {
    ctx.ui.notify(`No authentication configured for ${model.id}`, "warning");
    return null;
  }

  try {
    // 5. side-query：独立 sessionId，不写入主对话历史
    const response = await ctx.modelRegistry.complete(
      model,
      { messages: recapMessages },
      {
        maxTokens: 300,
        cacheRetention: "none",
        sessionId: uuidv7(),
      }
    );

    const recap = response.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("\n")
      .trim();

    return recap || null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.ui.notify(`Recap generation failed: ${message}`, "error");
    return null;
  }
}

function showRecap(ctx: ExtensionCommandContext, recap: string): void {
  if (ctx.hasUI) {
    ctx.ui.notify(`📋 ${recap}`, "info", { duration: 15000 });
  } else {
    console.log(`\n📋 Session Recap:\n${recap}\n`);
  }
}

// ============================================================================
// 扩展入口
// ============================================================================

export default function (pi: ExtensionAPI) {
  // ------------------------------------------------------------------------
  // 1. /recap 命令（手动触发）
  // ------------------------------------------------------------------------
  pi.registerCommand("recap", {
    description: "Generate a session recap to help you recall what you were doing",
    handler: async (_args, ctx) => {
      if (recapInProgress) {
        ctx.ui.notify("Recap is already in progress...", "warning");
        return;
      }

      ctx.ui.notify("Generating recap...", "info");

      const recap = await generateRecap(ctx);
      if (recap === "__EMPTY_SESSION__") {
        ctx.ui.notify("刚进入会话，还没有可回忆的内容。", "warning");
        return;
      }
      if (!recap) {
        ctx.ui.notify("Recap generation failed, see errors above.", "warning");
        return;
      }

      lastRecapAt = Date.now();
      showRecap(ctx, recap);
    },
  });

  // ------------------------------------------------------------------------
  // 2. session_start：加载配置、初始化计时
  // ------------------------------------------------------------------------
  pi.on("session_start", async (_event, ctx) => {
    currentConfig = loadConfig(ctx.cwd, join(getAgentDir(), "extensions", CONFIG_FILE_NAME));
    lastRecapAt = Date.now();
    recapInProgress = false;
  });

  // ------------------------------------------------------------------------
  // 3. turn_end：自动 recap 检查
  // ------------------------------------------------------------------------
  pi.on("turn_end", async (_event, ctx) => {
    if (!currentConfig.autoRecap) return;
    if (recapInProgress) return;

    const intervalMs = currentConfig.autoRecapIntervalMinutes * 60 * 1000;
    if (Date.now() - lastRecapAt < intervalMs) return;

    // 刚进入会话（历史为空）不触发
    const branch = ctx.sessionManager.getBranch();
    const messageCount = branch.filter(
      (e) => e.type === "message" && (e.message?.role === "user" || e.message?.role === "assistant")
    ).length;
    if (messageCount === 0) return;

    recapInProgress = true;
    try {
      const recap = await generateRecap(ctx);
      if (recap && recap !== "__EMPTY_SESSION__") {
        lastRecapAt = Date.now();
        showRecap(ctx, recap);
      }
    } finally {
      recapInProgress = false;
    }
  });
}
