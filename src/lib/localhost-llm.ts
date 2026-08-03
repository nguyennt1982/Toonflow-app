/**
 * Toonflow AI供应商模板 - Localhost LLM (llama.cpp)
 * @version 1.0
 *
 * 说明：
 * 1) llama-server 默认运行在 http://localhost:8080
 * 2) 兼容 OpenAI Chat Completion API 格式
 * 3) 仅用于文本生成（ScriptAgent/ProductionAgent 的 AI 推理）
 * 4) imageRequest/videoRequest/ttsRequest 均 throw，因为 LLM 不支持这些任务
 * 5) 核心用途：让 Toonflow 的 agents 能通过 localhost 调用本地 LLM 生成 prompt
 */

// ============================================================
// 类型定义
// ============================================================

type VideoMode =
  | "singleImage"
  | "startEndRequired"
  | "endFrameOptional"
  | "startFrameOptional"
  | "text"
  | (`videoReference:${number}` | `imageReference:${number}` | `audioReference:${number}`)[];

interface TextModel {
  name: string;
  modelName: string;
  type: "text";
  think: boolean;
}

interface VendorConfig {
  id: string;
  version: string;
  name: string;
  author: string;
  description?: string;
  icon?: string;
  inputs: { key: string; label: string; type: "text" | "password" | "url"; required: boolean; placeholder?: string }[];
  inputValues: Record<string, string>;
  models: TextModel[];
}

interface PollResult {
  completed: boolean;
  data?: string;
  error?: string;
}

// ============================================================
// 全局声明
// ============================================================

declare const createOpenAICompatible: any;
declare const pollTask: (fn: () => Promise<PollResult>, interval?: number, timeout?: number) => Promise<PollResult>;
declare const logger: (msg: string) => void;
declare const exports: {
  vendor: VendorConfig;
  textRequest: (m: TextModel, t: boolean, tl: 0 | 1 | 2 | 3) => any;
  imageRequest: () => Promise<string>;
  videoRequest: () => Promise<string>;
  ttsRequest: () => Promise<string>;
};

// ============================================================
// 供应商配置
// ============================================================

const vendor: VendorConfig = {
  id: "localhost-llm",
  version: "1.0",
  author: "toonflow",
  name: "Localhost LLM (llama.cpp)",
  description: "本地 llama.cpp 服务器，通过 OpenAI 兼容 API 提供文本生成能力。\n\n核心用途：让 Toonflow agents（ScriptAgent、ProductionAgent 及其子 agents）能够通过 localhost 调用本地 LLM 生成 prompt。\n\nllama-server 需要运行在 http://localhost:8080。",
  icon: "",
  inputs: [
    { key: "baseUrl", label: "llama-server URL", type: "url", required: true, placeholder: "http://localhost:8080" },
  ],
  inputValues: {
    baseUrl: "http://localhost:8080",
  },
  models: [
    { name: "Qwen2.5-7B-Instruct", modelName: "qwen2.5-7b-instruct", type: "text" as const, think: false },
    { name: "Qwen2.5-14B-Instruct", modelName: "qwen2.5-14b-instruct", type: "text" as const, think: false },
    { name: "Qwen2.5-32B-Instruct", modelName: "qwen2.5-32b-instruct", type: "text" as const, think: false },
    { name: "Qwen2.5-72B-Instruct", modelName: "qwen2.5-72b-instruct", type: "text" as const, think: false },
    { name: "Qwen2.5-Coder-32B-Instruct", modelName: "qwen2.5-coder-32b-instruct", type: "text" as const, think: false },
    { name: "Llama-3.3-70B-Instruct", modelName: "llama-3.3-70b-instruct", type: "text" as const, think: true },
    { name: "Llama-3.1-8B-Instruct", modelName: "llama-3.1-8b-instruct", type: "text" as const, think: false },
    { name: "Llama-3.1-70B-Instruct", modelName: "llama-3.1-70b-instruct", type: "text" as const, think: true },
    { name: "Mistral-7B-Instruct", modelName: "mistral-7b-instruct", type: "text" as const, think: false },
    { name: "Mistral-NeMo-12B", modelName: "mistral-nemo-12b", type: "text" as const, think: false },
    { name: "DeepSeek-R1-Distill-Qwen-7B", modelName: "deepseek-r1-distill-qwen-7b", type: "text" as const, think: true },
    { name: "DeepSeek-R1-Distill-Qwen-14B", modelName: "deepseek-r1-distill-qwen-14b", type: "text" as const, think: true },
    { name: "DeepSeek-R1-Distill-Llama-8B", modelName: "deepseek-r1-distill-llama-8b", type: "text" as const, think: true },
    { name: "Phi-4", modelName: "phi-4", type: "text" as const, think: false },
    { name: "Phi-3.5-mini", modelName: "phi-3.5-mini-instruct", type: "text" as const, think: false },
    { name: "Gemma-2-27B", modelName: "gemma-2-27b-it", type: "text" as const, think: false },
  ],
};

// ============================================================
// 辅助工具
// ============================================================

const getBaseUrl = (): string => {
  const base = vendor.inputValues.baseUrl || "http://localhost:8080";
  return base.replace(/\/+$/, "");
};

// ============================================================
// 适配器函数
// ============================================================

const textRequest = (model: TextModel, think: boolean, thinkLevel: 0 | 1 | 2 | 3) => {
  const baseUrl = getBaseUrl();
  const effortMap: Record<number, string> = { 0: "minimal", 1: "low", 2: "medium", 3: "high" };

  logger(`[localhost-llm] textRequest -> model=${model.modelName} think=${think} thinkLevel=${thinkLevel}`);

  // 关键：createOpenAICompatible 返回的是一个 SDK factory 对象
  // .chatModel(modelName) 返回的是一个 LanguageModel 实例
  // 这个实例会被 ai.Text 类传给 generateText/streamText 使用
  return createOpenAICompatible({
    name: "localhost-llm",
    baseURL: `${baseUrl}/v1`,
    apiKey: "local", // llama.cpp 本地服务不需要 API key
    fetch: async (url: string, options?: RequestInit) => {
      if (think) {
        // llama.cpp 通过 extension 参数支持 thinking
        const rawBody = JSON.parse((options?.body as string) ?? "{}");
        const body = {
          ...rawBody,
          thinking: { type: "enabled" },
          reasoning_effort: effortMap[thinkLevel],
        };
        return await fetch(url, { ...options, body: JSON.stringify(body) });
      }
      return await fetch(url, options);
    },
  }).chatModel(model.modelName);
};

// llama.cpp 不支持 image/video/tts，抛出错误引导用户使用正确的 vendor
const imageRequest = async (): Promise<string> => {
  throw new Error("llama.cpp 不支持图像生成。请切换到 'localhost-comfyui' vendor 进行图像/视频生成。");
};

const videoRequest = async (): Promise<string> => {
  throw new Error("llama.cpp 不支持视频生成。请切换到 'localhost-comfyui' vendor 进行图像/视频生成。");
};

const ttsRequest = async (): Promise<string> => {
  throw new Error("llama.cpp 不支持 TTS。如需 TTS 功能请另行配置。");
};

// ============================================================
// 导出
// ============================================================

exports.vendor = vendor;
exports.textRequest = textRequest;
exports.imageRequest = imageRequest;
exports.videoRequest = videoRequest;
exports.ttsRequest = ttsRequest;

export {};
