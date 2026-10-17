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
  convertToLlm,
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

interface GenerateRecapResult {
  recap: string | null;
  error: string | null;
  emptySession?: boolean;
}

async function generateRecap(ctx: ExtensionCommandContext, pi: ExtensionAPI): Promise<GenerateRecapResult> {
  const branch = ctx.sessionManager.getBranch();

  // 1. 只有刚进入会话（历史为空）才不值得 recap，其余任何时候都支持
  const messageEntries = branch.filter(
    (e) => e.type === "message" && (e.message?.role === "user" || e.message?.role === "assistant")
  );
  if (messageEntries.length === 0) {
    return { recap: null, error: null, emptySession: true };
  }

  // 2. 构建与主会话 100% 同构的前缀上下文（最大化 Prompt Cache 复用）
  //    - systemPrompt：与主会话完全一致
  //    - tools：与主会话声明的激活工具列表完全一致（避免缺少工具导致 API 报 400 或破坏前缀缓存）
  //    - messages：完整包含 compaction summary 与历史交互，末尾仅追加一条纯文本引导用户消息
  const systemPrompt = ctx.getSystemPrompt();

  const activeNames = new Set(pi.getActiveTools());
  const activeTools = pi.getAllTools()
    .filter((t) => activeNames.has(t.name))
    .map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));

  const projection = ctx.sessionManager.buildSessionProjection();
  const llmMessages = convertToLlm(projection.messages);

  const tailPrompt = `请用 2-3 句话总结一下我们到目前为止的对话进展，帮我快速回忆：
- 大目标是什么
- 完成了什么
- 还在做什么（如果有未完成的）
- 最后几轮在干嘛

要求：
- 简洁，总共不超过 100 字
- 不要调用任何工具，直接回复纯文本
- 直接说内容，不要说"这个对话在..."`;

  const tailUserMessage = {
    role: "user" as const,
    content: [{ type: "text" as const, text: tailPrompt }],
    timestamp: Date.now(),
  };

  const requestContext = {
    systemPrompt,
    tools: activeTools,
    messages: [...llmMessages, tailUserMessage],
  };

  // 3. 多模型候选队列：轻量模型优先，自动逐级降级容灾，最后由主会话模型兜底
  const rawCandidates = [
    ctx.modelRegistry.find("google", "gemini-2.5-flash"),
    ctx.modelRegistry.find("openai", "gpt-4.1-mini"),
    ctx.modelRegistry.find("anthropic", "claude-3-5-haiku-20241022"),
    ctx.model,
  ];

  const seen = new Set<string>();
  const candidates = rawCandidates.filter((m): m is NonNullable<typeof m> => {
    if (!m || !ctx.modelRegistry.hasConfiguredAuth(m)) return false;
    const key = `${m.provider}/${m.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (candidates.length === 0) {
    return { recap: null, error: "没有已配置认证的可用模型用于生成回忆" };
  }

  // 4. 逐个模型发起 side-query，捕获单点异常并自动回退重试
  let lastError = "";
  for (const candidate of candidates) {
    try {
      const response = await ctx.modelRegistry.complete(
        candidate,
        requestContext,
        {
          maxTokens: 300,
          cacheRetention: "none",
          sessionId: uuidv7(),
          signal: AbortSignal.timeout(45000), // 45 秒超时控制，防止请求挂起
        }
      );

      const recap = response.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("\n")
        .trim();

      if (recap) {
        return { recap, error: null };
      }
    } catch (err: any) {
      lastError = err instanceof Error ? err.message : String(err);
      // 当前模型失败，继续尝试下一个候选模型（容灾降级）
      continue;
    }
  }

  return { recap: null, error: lastError || "模型未返回有效总结内容" };
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

      const { recap, error, emptySession } = await generateRecap(ctx, pi);
      if (emptySession) {
        ctx.ui.notify("刚进入会话，还没有可回忆的内容。", "warning");
        return;
      }
      if (!recap) {
        ctx.ui.notify(`Recap generation failed: ${error || "未知原因"}`, "error");
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
      const { recap, emptySession } = await generateRecap(ctx, pi);
      if (recap && !emptySession) {
        lastRecapAt = Date.now();
        showRecap(ctx, recap);
      } else if (!emptySession) {
        // 自动触发失败退避：将下次触发时间推迟 10 分钟，避免每轮会话重复轰炸 API
        lastRecapAt = Date.now() - intervalMs + 10 * 60 * 1000;
      }
    } finally {
      recapInProgress = false;
    }
  });
}
