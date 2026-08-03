/**
 * Toonflow AI供应商模板 - Localhost ComfyUI
 * @version 1.0
 *
 * 说明：
 * 1) ComfyUI 默认运行在 http://localhost:8188
 * 2) 通过 ComfyUI HTTP API 提交 workflow 并轮询结果
 * 3) 支持图像生成（Flux2-Klein, SDXL 等）和视频生成（LTX-2.3, Wan2.6 等）
 * 4) workflow JSON 根据 modelName 动态构建
 * 5) imageRequest 和 videoRequest 返回 base64 数据
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

interface ImageModel {
  name: string;
  modelName: string;
  type: "image";
  mode: ("text" | "singleImage" | "multiReference")[];
}

interface VideoModel {
  name: string;
  modelName: string;
  type: "video";
  mode: VideoMode[];
  audio: "optional" | false | true;
  durationResolutionMap: { duration: number[]; resolution: string[] }[];
}

interface TTSModel {
  name: string;
  modelName: string;
  type: "tts";
  voices: { title: string; voice: string }[];
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
  models: (TextModel | ImageModel | VideoModel | TTSModel)[];
}

interface ReferenceList {
  type: "image" | "audio" | "video";
  sourceType: "base64";
  base64: string;
}

interface ImageConfig {
  prompt: string;
  referenceList?: Extract<ReferenceList, { type: "image" }>[];
  size: "1K" | "2K" | "4K";
  aspectRatio: `${number}:${number}`;
}

interface VideoConfig {
  duration: number;
  resolution: string;
  aspectRatio: "16:9" | "9:16";
  prompt: string;
  referenceList?: ReferenceList[];
  audio?: boolean;
  mode: VideoMode[];
}

interface PollResult {
  completed: boolean;
  data?: string;
  error?: string;
}

// ============================================================
// 全局声明
// ============================================================

declare const axios: any;
declare const pollTask: (fn: () => Promise<PollResult>, interval?: number, timeout?: number) => Promise<PollResult>;
declare const urlToBase64: (url: string) => Promise<string>;
declare const logger: (msg: string) => void;
declare const crypto: any;
declare const exports: {
  vendor: VendorConfig;
  textRequest: (m: TextModel, t: boolean, tl: 0 | 1 | 2 | 3) => any;
  imageRequest: (config: ImageConfig, model: ImageModel) => Promise<string>;
  videoRequest: (config: VideoConfig, model: VideoModel) => Promise<string>;
  ttsRequest: (config: any, model: TTSModel) => Promise<string>;
};

// ============================================================
// 供应商配置
// ============================================================

const vendor: VendorConfig = {
  id: "localhost-comfyui",
  version: "1.0",
  author: "toonflow",
  name: "Localhost ComfyUI",
  description: "本地 ComfyUI 服务器，通过 HTTP API 提供图像/视频生成能力。\n\nComfyUI 需要运行在 http://localhost:8188，并安装对应的模型节点。",
  icon: "",
  inputs: [
    { key: "baseUrl", label: "ComfyUI URL", type: "url", required: true, placeholder: "http://localhost:8188" },
    { key: "maxRetries", label: "最大重试次数", type: "text", required: false, placeholder: "3" },
  ],
  inputValues: {
    baseUrl: "http://localhost:8188",
    maxRetries: "3",
  },
  models: [
    // === 图像模型 ===
    {
      name: "Flux2-Klein",
      modelName: "flux2-klein",
      type: "image" as const,
      mode: ["text", "singleImage", "multiReference"],
    },
    {
      name: "SDXL Turbo",
      modelName: "sdxl-turbo",
      type: "image" as const,
      mode: ["text", "singleImage"],
    },
    {
      name: "SD 1.5",
      modelName: "sd1.5",
      type: "image" as const,
      mode: ["text", "singleImage", "multiReference"],
    },
    {
      name: "Flux-dev",
      modelName: "flux-dev",
      type: "image" as const,
      mode: ["text", "singleImage", "multiReference"],
    },
    // === 视频模型 ===
    {
      name: "LTX-2.3 (Video)",
      modelName: "ltx2.3",
      type: "video" as const,
      mode: ["text", "singleImage", "startEndRequired", "startFrameOptional"],
      audio: "optional" as const,
      durationResolutionMap: [{ duration: [2, 4, 6, 8], resolution: ["720p", "1080p"] }],
    },
    {
      name: "Wan2.6 (Video)",
      modelName: "wan2.6",
      type: "video" as const,
      mode: ["singleImage", "startEndRequired", "startFrameOptional"],
      audio: "optional" as const,
      durationResolutionMap: [{ duration: [4, 5, 6, 7, 8, 10, 12], resolution: ["480p", "720p", "1080p"] }],
    },
    {
      name: "Seedance 2.0",
      modelName: "seedance-2.0",
      type: "video" as const,
      mode: ["text", "singleImage", "startFrameOptional"],
      audio: "optional" as const,
      durationResolutionMap: [{ duration: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], resolution: ["480p", "720p"] }],
    },
    {
      name: "Kling Video",
      modelName: "kling",
      type: "video" as const,
      mode: ["singleImage", "startEndRequired"],
      audio: false as const,
      durationResolutionMap: [{ duration: [5, 10], resolution: ["720p"] }],
    },
  ],
};

// ============================================================
// 辅助工具
// ============================================================

const getComfyBaseUrl = (): string => {
  const base = vendor.inputValues.baseUrl || "http://localhost:8188";
  return base.replace(/\/+$/, "");
};

const getMaxRetries = (): number => {
  const n = parseInt(vendor.inputValues.maxRetries || "3", 10);
  return Number.isFinite(n) && n > 0 ? n : 3;
};

/**
 * 提交 ComfyUI workflow
 * @returns { prompt_id, client_id }
 */
async function comfySubmitWorkflow(workflow: Record<string, any>): Promise<{ promptId: string; clientId: string }> {
  const baseUrl = getComfyBaseUrl();
  const clientId = crypto.randomUUID();

  logger(`[ComfyUI] 提交 workflow, client_id=${clientId}`);

  const res = await axios.post(`${baseUrl}/prompt`, { prompt: workflow, client_id: clientId });

  if (!res.data || !res.data.prompt_id) {
    throw new Error(`ComfyUI 提交失败: ${JSON.stringify(res.data).slice(0, 500)}`);
  }

  return { promptId: res.data.prompt_id, clientId };
}

/**
 * 轮询 ComfyUI 任务结果
 */
async function comfyPollResult(promptId: string, timeoutMs = 600000): Promise<Record<string, any>> {
  const baseUrl = getComfyBaseUrl();
  const maxRetries = getMaxRetries();

  return pollTask(
    async (): Promise<PollResult> => {
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          const res = await axios.get(`${baseUrl}/history/${promptId}`);
          const data = res.data;

          if (data[promptId]) {
            logger(`[ComfyUI] 任务完成: ${promptId}`);
            return { completed: true, data: JSON.stringify(data) };
          }

          if (data && data.status && data.status.ready) {
            return { completed: false };
          }

          return { completed: false };
        } catch (err: any) {
          if (attempt < maxRetries - 1) {
            logger(`[ComfyUI] 轮询失败 (尝试 ${attempt + 1}/${maxRetries}): ${err.message}`);
          }
          return { completed: false, error: err.message };
        }
      }
      return { completed: false, error: "ComfyUI 轮询超过最大重试次数" };
    },
    5000,
    timeoutMs,
  );
}

/**
 * 从 ComfyUI history 结果中提取图像 base64
 */
async function extractImageFromHistory(historyDataStr: string): Promise<string> {
  const data = JSON.parse(historyDataStr);
  // 尝试所有可能的 promptId 键
  let result = null;
  for (const [key, val] of Object.entries(data)) {
    if (val && (val as any).outputs) {
      result = val as any;
      break;
    }
  }
  if (!result || !result.outputs) {
    throw new Error("ComfyUI 图像结果未找到");
  }

  for (const [nodeId, output] of Object.entries(result.outputs)) {
    const imgOutput = output as any;
    if (imgOutput.images) {
      for (const img of imgOutput.images) {
        const { filename, subfolder, type } = img;
        const viewUrl = `${getComfyBaseUrl()}/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder || "")}&type=${type || "output"}`;
        logger(`[ComfyUI] 提取图像: ${viewUrl}`);
        return await urlToBase64(viewUrl);
      }
    }
  }

  throw new Error("ComfyUI 输出中未找到图像");
}

/**
 * 从 ComfyUI history 结果中提取视频 base64
 */
async function extractVideoFromHistory(historyDataStr: string): Promise<string> {
  const data = JSON.parse(historyDataStr);
  let result = null;
  for (const [key, val] of Object.entries(data)) {
    if (val && (val as any).outputs) {
      result = val as any;
      break;
    }
  }
  if (!result || !result.outputs) {
    throw new Error("ComfyUI 视频结果未找到");
  }

  for (const [nodeId, output] of Object.entries(result.outputs)) {
    const vidOutput = output as any;
    const videos = vidOutput.videos || vidOutput.gifs || [];
    if (videos.length > 0) {
      const vid = videos[0];
      const { filename, subfolder, type } = vid;
      const viewUrl = `${getComfyBaseUrl()}/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder || "")}&type=${type || "output"}`;
      logger(`[ComfyUI] 提取视频: ${viewUrl}`);
      return await urlToBase64(viewUrl);
    }
  }

  throw new Error("ComfyUI 输出中未找到视频");
}

// ============================================================
// 辅助: 构建 ComfyUI workflow JSON
// ============================================================

function buildFlux2KleinWorkflow(config: ImageConfig): Record<string, any> {
  const seed = Math.floor(Math.random() * 999999999);
  return {
    "1": {
      class_type: "KSampler",
      inputs: {
        seed, steps: 30, cfg: 6.5,
        sampler_name: "euler_ancestral", scheduler: "normal", denoise: 1.0,
        model: ["4", 0],
        positive: ["6", 0], negative: ["7", 0],
        latent_image: ["8", 0],
      },
    },
    "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "flux2-klein.safetensors" } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: config.prompt, clip: ["4", 1] } },
    "7": { class_type: "CLIPTextEncode", inputs: { text: "", clip: ["4", 1] } },
    "8": { class_type: "EmptyLatentImage", inputs: { width: 1024, height: 1024, batch_size: 1 } },
    "9": { class_type: "VAEDecode", inputs: { samples: ["1", 0], vae: ["4", 2] } },
    "10": { class_type: "SaveImage", inputs: { images: ["9", 0], filename_prefix: "toonflow_flux2" } },
  };
}

function buildSDXLTurboWorkflow(config: ImageConfig): Record<string, any> {
  return {
    "1": {
      class_type: "KSampler",
      inputs: {
        seed: Math.floor(Math.random() * 999999999), steps: 4, cfg: 1.0,
        sampler_name: "euler_ancestral", scheduler: "normal", denoise: 1.0,
        model: ["4", 0], positive: ["6", 0], negative: ["7", 0], latent_image: ["8", 0],
      },
    },
    "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "sdxl-turbo.safetensors" } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: config.prompt, clip: ["4", 1] } },
    "7": { class_type: "CLIPTextEncode", inputs: { text: "", clip: ["4", 1] } },
    "8": { class_type: "EmptyLatentImage", inputs: { width: 1024, height: 1024, batch_size: 1 } },
    "9": { class_type: "VAEDecode", inputs: { samples: ["1", 0], vae: ["4", 2] } },
    "10": { class_type: "SaveImage", inputs: { images: ["9", 0], filename_prefix: "toonflow_sdxl" } },
  };
}

function buildSD15Workflow(config: ImageConfig): Record<string, any> {
  return {
    "1": {
      class_type: "KSampler",
      inputs: {
        seed: Math.floor(Math.random() * 999999999), steps: 20, cfg: 7.0,
        sampler_name: "euler", scheduler: "normal", denoise: 1.0,
        model: ["4", 0], positive: ["6", 0], negative: ["7", 0], latent_image: ["8", 0],
      },
    },
    "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "sd1.5/base.safetensors" } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: config.prompt, clip: ["4", 1] } },
    "7": { class_type: "CLIPTextEncode", inputs: { text: "worst quality, low quality", clip: ["4", 1] } },
    "8": { class_type: "EmptyLatentImage", inputs: { width: 512, height: 512, batch_size: 1 } },
    "9": { class_type: "VAEDecode", inputs: { samples: ["1", 0], vae: ["4", 2] } },
    "10": { class_type: "SaveImage", inputs: { images: ["9", 0], filename_prefix: "toonflow_sd15" } },
  };
}

function buildFluxDevWorkflow(config: ImageConfig): Record<string, any> {
  return {
    "1": {
      class_type: "KSampler",
      inputs: {
        seed: Math.floor(Math.random() * 999999999), steps: 25, cfg: 3.5,
        sampler_name: "euler", scheduler: "normal", denoise: 1.0,
        model: ["4", 0], positive: ["6", 0], negative: ["7", 0], latent_image: ["8", 0],
      },
    },
    "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "flux-dev-fp8.safetensors" } },
    "6": { class_type: "CLIPTextEncodeFlux", inputs: { clip: ["4", 1], clip2: ["4", 2], prompt: config.prompt, t5xxl: "", silx: "" } },
    "7": { class_type: "CLIPTextEncodeFlux", inputs: { clip: ["4", 1], clip2: ["4", 2], prompt: "", t5xxl: "", silx: "" } },
    "8": { class_type: "EmptyLatentImage", inputs: { width: 1024, height: 1024, batch_size: 1 } },
    "9": { class_type: "VAEDecode", inputs: { samples: ["1", 0], vae: ["4", 3] } },
    "10": { class_type: "SaveImage", inputs: { images: ["9", 0], filename_prefix: "toonflow_fluxdev" } },
  };
}

function buildLTX23Workflow(config: VideoConfig): Record<string, any> {
  const seed = Math.floor(Math.random() * 999999999);
  return {
    "1": { class_type: "LTX2VideoToVideo", inputs: {
      width: 768, height: 512, length: config.duration, motion_bucket: 127,
      flow_shift: 1.0, noise_scale: 0.0, seed,
      conditioning: ["2", 0], conditioning_end: ["3", 0], negative_conditioning: ["4", 0],
      latent_conditioning: ["5", 0], model: ["6", 0], vae: ["7", 0],
    }},
    "2": { class_type: "CLIPTextEncode", inputs: { text: config.prompt, clip: ["6", 1] } },
    "3": { class_type: "CLIPTextEncode", inputs: { text: "", clip: ["6", 1] } },
    "4": { class_type: "CLIPTextEncode", inputs: { text: "", clip: ["6", 1] } },
    "5": { class_type: "LTX2Conditioning", inputs: { type: "video", frame_rate: 25, conditioning: ["2", 0] } },
    "6": { class_type: "LTX2ModelLoader", inputs: { checkpoint_name: "ltx-2.3.safetensors" } },
    "7": { class_type: "LTX2VAELoader", inputs: { vae_name: "ltx-2.3.vae.safetensors" } },
    "8": { class_type: "EmptyLTX2LatentVideo", inputs: { width: 768, height: 512, length: config.duration, batch_size: 1 } },
    "9": { class_type: "LTX2VideoDecode", inputs: { samples: ["1", 0], vae: ["7", 0] } },
    "10": { class_type: "SaveVideo", inputs: { frames: ["9", 0], filename_prefix: "toonflow_ltx23" } },
  };
}

function buildWan26Workflow(config: VideoConfig): Record<string, any> {
  const seed = Math.floor(Math.random() * 999999999);
  const hasRef = config.referenceList && config.referenceList.some(r => r.type === "image");

  if (!hasRef && config.mode.includes("text")) {
    return {
      "1": { class_type: "Wan26TextToVideo", inputs: {
        prompt: config.prompt, negative_prompt: "", width: 832, height: 480,
        frames: Math.round(config.duration * 24), fps: 24, seed, guidance: 6.0,
        num_inference_steps: 30, model: ["5", 0], vae: ["6", 0],
      }},
      "5": { class_type: "Wan26ModelLoader", inputs: { model_name: "wan2.6.safetensors" } },
      "6": { class_type: "Wan26VAELoader", inputs: { vae_name: "wan2.6.vae.safetensors" } },
      "7": { class_type: "SaveVideo", inputs: { frames: ["1", 0], filename_prefix: "toonflow_wan26" } },
    };
  }

  return {
    "1": { class_type: "Wan26ImageToVideo", inputs: {
      prompt: config.prompt, negative_prompt: "", width: 832, height: 480,
      frames: Math.round(config.duration * 24), fps: 24, seed, guidance: 6.0,
      num_inference_steps: 30,
      start_image: config.referenceList?.filter(r => r.type === "image")?.[0]?.base64 || null,
      model: ["5", 0], vae: ["6", 0],
    }},
    "5": { class_type: "Wan26ModelLoader", inputs: { model_name: "wan2.6.safetensors" } },
    "6": { class_type: "Wan26VAELoader", inputs: { vae_name: "wan2.6.vae.safetensors" } },
    "7": { class_type: "SaveVideo", inputs: { frames: ["1", 0], filename_prefix: "toonflow_wan26" } },
  };
}

function buildSeedanceWorkflow(config: VideoConfig): Record<string, any> {
  const seed = Math.floor(Math.random() * 999999999);
  const hasRef = config.referenceList && config.referenceList.some(r => r.type === "image");

  if (config.mode.includes("text") && !hasRef) {
    return {
      "1": { class_type: "SeedanceTextToVideo", inputs: {
        prompt: config.prompt, negative_prompt: "", width: 1280, height: 720,
        duration: config.duration, seed, guidance_scale: 7.5,
        num_inference_steps: 50, model: ["5", 0],
      }},
      "5": { class_type: "SeedanceModelLoader", inputs: { model_name: "seedance-2.0.safetensors" } },
      "7": { class_type: "SaveVideo", inputs: { frames: ["1", 0], filename_prefix: "toonflow_seedance" } },
    };
  }

  return {
    "1": { class_type: "SeedanceImageToVideo", inputs: {
      prompt: config.prompt, negative_prompt: "", width: 1280, height: 720,
      duration: config.duration, seed, guidance_scale: 7.5,
      num_inference_steps: 50,
      start_image: config.referenceList?.filter(r => r.type === "image")?.[0]?.base64 || null,
      model: ["5", 0],
    }},
    "5": { class_type: "SeedanceModelLoader", inputs: { model_name: "seedance-2.0.safetensors" } },
    "7": { class_type: "SaveVideo", inputs: { frames: ["1", 0], filename_prefix: "toonflow_seedance" } },
  };
}

function buildKlingWorkflow(config: VideoConfig): Record<string, any> {
  return {
    "1": { class_type: "KlingImageToVideo", inputs: {
      prompt: config.prompt, negative_prompt: "", width: 1024, height: 576,
      duration: config.duration, seed: Math.floor(Math.random() * 999999999),
      model: ["5", 0],
    }},
    "5": { class_type: "KlingModelLoader", inputs: { model_name: "kling.safetensors" } },
    "7": { class_type: "SaveVideo", inputs: { frames: ["1", 0], filename_prefix: "toonflow_kling" } },
  };
}

function buildWorkflow(config: ImageConfig | VideoConfig, model: ImageModel | VideoModel): Record<string, any> {
  if (model.type === "image") {
    const imgConfig = config as ImageConfig;
    switch (model.modelName) {
      case "flux2-klein": return buildFlux2KleinWorkflow(imgConfig);
      case "sdxl-turbo": return buildSDXLTurboWorkflow(imgConfig);
      case "sd1.5": return buildSD15Workflow(imgConfig);
      case "flux-dev": return buildFluxDevWorkflow(imgConfig);
      default: return buildFlux2KleinWorkflow(imgConfig);
    }
  }

  const vidConfig = config as VideoConfig;
  switch (model.modelName) {
    case "ltx2.3": return buildLTX23Workflow(vidConfig);
    case "wan2.6": return buildWan26Workflow(vidConfig);
    case "seedance-2.0": return buildSeedanceWorkflow(vidConfig);
    case "kling": return buildKlingWorkflow(vidConfig);
    default: return buildLTX23Workflow(vidConfig);
  }
}

// ============================================================
// 适配器函数
// ============================================================

const textRequest = (model: TextModel, think: boolean, thinkLevel: number): never => {
  throw new Error("ComfyUI 不支持文本生成。请切换到 'localhost-llm' vendor 进行文本推理。");
};

// ============================================================
// 图像请求
// ============================================================

const imageRequest = async (config: ImageConfig, model: ImageModel): Promise<string> => {
  logger(`[ComfyUI] imageRequest -> model=${model.modelName} prompt=${config.prompt.slice(0, 100)}`);

  const workflow = buildWorkflow(config, model);
  const { promptId } = await comfySubmitWorkflow(workflow);

  const pollResult = await pollTask(
    async (): Promise<PollResult> => {
      const baseUrl = getComfyBaseUrl();
      const res = await axios.get(`${baseUrl}/history/${promptId}`);
      const data = res.data;

      if (data[promptId]) {
        try {
          const base64 = await extractImageFromHistory(JSON.stringify(data));
          return { completed: true, data: base64 };
        } catch (e: any) {
          return { completed: true, error: e.message || "图像提取失败" };
        }
      }

      return { completed: false };
    },
    5000,
    600000,
  );

  if (pollResult.error) {
    throw new Error(pollResult.error);
  }

  return pollResult.data!;
};

// ============================================================
// 视频请求
// ============================================================

const videoRequest = async (config: VideoConfig, model: VideoModel): Promise<string> => {
  logger(`[ComfyUI] videoRequest -> model=${model.modelName} duration=${config.duration}s`);

  const workflow = buildWorkflow(config, model);
  const { promptId } = await comfySubmitWorkflow(workflow);

  const pollResult = await pollTask(
    async (): Promise<PollResult> => {
      const baseUrl = getComfyBaseUrl();
      const res = await axios.get(`${baseUrl}/history/${promptId}`);
      const data = res.data;

      if (data[promptId]) {
        try {
          const base64 = await extractVideoFromHistory(JSON.stringify(data));
          return { completed: true, data: base64 };
        } catch (e: any) {
          return { completed: true, error: e.message || "视频提取失败" };
        }
      }

      return { completed: false };
    },
    5000,
    900000,
  );

  if (pollResult.error) {
    throw new Error(pollResult.error);
  }

  return pollResult.data!;
};

const ttsRequest = async (): Promise<string> => {
  throw new Error("ComfyUI 不支持 TTS。如需 TTS 功能请另行配置。");
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
