/**
 * Migration: 注册 localhost-llm 和 localhost-comfyui vendor 到 Toonflow DB
 *
 * 用途：一次性执行，将两个本地 vendor 注册到数据库
 *
 * 用法：
 *   npx ts-node src/lib/localhost-migration.ts
 *
 * 或者在 app.ts 初始化时自动调用（推荐）
 */

import { Knex } from "knex";
import * as fs from "fs";
import * as path from "path";

// ============================================================
// 常量配置
// ============================================================

const LLM_MODEL = "Qwen3.6-35B-A3B-Q4_K_M";
const LLM_BASE_URL = process.env.TOONFLOW_LLM_BASE_URL || "http://host.docker.internal:8080";
const LLM_MODELS = [{ name: LLM_MODEL, modelName: LLM_MODEL, type: "text", think: false }];

// ============================================================
// 读取 vendor 源码
// ============================================================

function readVendorCode(id: string): string {
  const filePath = path.join(__dirname, `${id}.ts`);
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, "utf-8");
  }
  throw new Error(`Vendor file not found: ${filePath}`);
}

// ============================================================
// 写入 vendor code 到文件系统
// ============================================================

function writeVendorCode(id: string, tsCode: string, vendorDir: string): void {
  const dir = path.join(vendorDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.ts`), tsCode);
}

// ============================================================
// 注册 vendor
// ============================================================

export async function registerLocalHostVendors(knex: Knex, vendorDir: string): Promise<void> {
  // --- 1. 读取 vendor 源码 ---
  const localhostLlmCode = readVendorCode("localhost-llm");
  const localhostComfyuiCode = readVendorCode("localhost-comfyui");

  // --- 2. 写入 vendor code 文件 ---
  writeVendorCode("localhost-llm", localhostLlmCode, vendorDir);
  writeVendorCode("localhost-comfyui", localhostComfyuiCode, vendorDir);

  // --- 3. 注册到 o_vendorConfig 表 ---
  // 检查是否已存在
  const existingLlm = await knex("o_vendorConfig").where("id", "localhost-llm").first();
  const existingComfyui = await knex("o_vendorConfig").where("id", "localhost-comfyui").first();

  if (!existingLlm) {
    await knex("o_vendorConfig").insert({
      id: "localhost-llm",
      inputValues: JSON.stringify({ baseUrl: LLM_BASE_URL }),
      models: JSON.stringify(LLM_MODELS),
      enable: 1,
    });
    console.log("[migration] ✅ Registered vendor: localhost-llm (enabled)");
  } else {
    await knex("o_vendorConfig").where("id", "localhost-llm").update({
      inputValues: JSON.stringify({ baseUrl: LLM_BASE_URL }),
      models: JSON.stringify(LLM_MODELS),
      enable: 1,
    });
    console.log("[migration] ⚠️ Updated existing vendor: localhost-llm");
  }

  if (!existingComfyui) {
    await knex("o_vendorConfig").insert({
      id: "localhost-comfyui",
      inputValues: JSON.stringify({ baseUrl: "http://localhost:8188", maxRetries: "3" }),
      models: "[]",
      enable: 1,
    });
    console.log("[migration] ✅ Registered vendor: localhost-comfyui (enabled)");
  } else {
    await knex("o_vendorConfig").where("id", "localhost-comfyui").update({
      inputValues: JSON.stringify({ baseUrl: "http://localhost:8188", maxRetries: "3" }),
      enable: 1,
    });
    console.log("[migration] ⚠️ Updated existing vendor: localhost-comfyui");
  }

  // --- 4. 注册 agent deploy 配置 ---
  // 将 scriptAgent, productionAgent, universalAi 指向 localhost-llm 模型
  const deployConfig = [
    {
      id: 100,
      key: "scriptAgent",
      name: "剧本Agent (本地 LLM)",
      model: LLM_MODEL,
      modelName: `localhost-llm:${LLM_MODEL}`,
      vendorId: "localhost-llm",
      desc: `用于读取原文生成故事骨架、改编策略。本地 LLM 推荐 ${LLM_MODEL}`,
      temperature: 0.7,
      maxOutputTokens: 4096,
      disabled: false,
    },
    {
      id: 101,
      key: "productionAgent",
      name: "生产Agent (本地 LLM)",
      model: LLM_MODEL,
      modelName: `localhost-llm:${LLM_MODEL}`,
      vendorId: "localhost-llm",
      desc: `对工作流进行调度和管理。本地 LLM 推荐 ${LLM_MODEL}`,
      temperature: 0.7,
      maxOutputTokens: 4096,
      disabled: false,
    },
    {
      id: 102,
      key: "universalAi",
      name: "通用AI (本地 LLM)",
      model: LLM_MODEL,
      modelName: `localhost-llm:${LLM_MODEL}`,
      vendorId: "localhost-llm",
      desc: `用于小说事件提取、资产提示词生成等边缘功能。本地 LLM 推荐 ${LLM_MODEL}`,
      temperature: 0.7,
      maxOutputTokens: 2048,
      disabled: false,
    },
  ];

  for (const cfg of deployConfig) {
    const exists = await knex("o_agentDeploy").where("key", cfg.key).first();
    if (!exists) {
      await knex("o_agentDeploy").insert(cfg);
      console.log(`[migration] ✅ Registered agent deploy: ${cfg.key} → ${cfg.modelName}`);
    } else {
      await knex("o_agentDeploy").where("key", cfg.key).update({
        model: cfg.model,
        modelName: cfg.modelName,
        vendorId: cfg.vendorId,
        temperature: cfg.temperature,
        maxOutputTokens: cfg.maxOutputTokens,
      });
      console.log(`[migration] ⚠️ Updated agent deploy: ${cfg.key} → ${cfg.modelName}`);
    }
  }

  // --- 5. 注册子 agents 配置 ---
  const childAgents = [
    { id: 200, key: "scriptAgent:decisionAgent", name: "剧本Agent:决策层 (本地)", model: LLM_MODEL, modelName: `localhost-llm:${LLM_MODEL}`, vendorId: "localhost-llm", desc: "决策层 - 本地 LLM", temperature: 0.7, maxOutputTokens: 2048 },
    { id: 201, key: "scriptAgent:supervisionAgent", name: "剧本Agent:监督层 (本地)", model: LLM_MODEL, modelName: `localhost-llm:${LLM_MODEL}`, vendorId: "localhost-llm", desc: "监督层 - 本地 LLM", temperature: 0.7, maxOutputTokens: 1024 },
    { id: 202, key: "scriptAgent:storySkeletonAgent", name: "剧本Agent:故事骨架 (本地)", model: LLM_MODEL, modelName: `localhost-llm:${LLM_MODEL}`, vendorId: "localhost-llm", desc: "故事骨架生成 - 本地 LLM", temperature: 0.7, maxOutputTokens: 4096 },
    { id: 203, key: "scriptAgent:adaptationStrategyAgent", name: "剧本Agent:改编策略 (本地)", model: LLM_MODEL, modelName: `localhost-llm:${LLM_MODEL}`, vendorId: "localhost-llm", desc: "改编策略生成 - 本地 LLM", temperature: 0.7, maxOutputTokens: 4096 },
    { id: 204, key: "scriptAgent:scriptAgent", name: "剧本Agent:剧本生成 (本地)", model: LLM_MODEL, modelName: `localhost-llm:${LLM_MODEL}`, vendorId: "localhost-llm", desc: "剧本生成 - 本地 LLM", temperature: 0.7, maxOutputTokens: 8192 },
    { id: 205, key: "productionAgent:decisionAgent", name: "生产Agent:决策层 (本地)", model: LLM_MODEL, modelName: `localhost-llm:${LLM_MODEL}`, vendorId: "localhost-llm", desc: "决策层 - 本地 LLM", temperature: 0.7, maxOutputTokens: 2048 },
    { id: 206, key: "productionAgent:supervisionAgent", name: "生产Agent:监督层 (本地)", model: LLM_MODEL, modelName: `localhost-llm:${LLM_MODEL}`, vendorId: "localhost-llm", desc: "监督层 - 本地 LLM", temperature: 0.7, maxOutputTokens: 1024 },
    { id: 207, key: "productionAgent:deriveAssetsAgent", name: "生产Agent:衍生资产 (本地)", model: LLM_MODEL, modelName: `localhost-llm:${LLM_MODEL}`, vendorId: "localhost-llm", desc: "衍生资产提取 - 本地 LLM", temperature: 0.7, maxOutputTokens: 4096 },
    { id: 208, key: "productionAgent:generateAssetsAgent", name: "生产Agent:生成资产 (本地)", model: LLM_MODEL, modelName: `localhost-llm:${LLM_MODEL}`, vendorId: "localhost-llm", desc: "生成资产 - 本地 LLM", temperature: 0.7, maxOutputTokens: 4096 },
    { id: 209, key: "productionAgent:directorPlanAgent", name: "生产Agent:导演规划 (本地)", model: LLM_MODEL, modelName: `localhost-llm:${LLM_MODEL}`, vendorId: "localhost-llm", desc: "导演规划 - 本地 LLM", temperature: 0.7, maxOutputTokens: 4096 },
    { id: 210, key: "productionAgent:storyboardGenAgent", name: "生产Agent:分镜生成 (本地)", model: LLM_MODEL, modelName: `localhost-llm:${LLM_MODEL}`, vendorId: "localhost-llm", desc: "分镜生成 - 本地 LLM", temperature: 0.7, maxOutputTokens: 4096 },
    { id: 211, key: "productionAgent:storyboardPanelAgent", name: "生产Agent:分镜面板 (本地)", model: LLM_MODEL, modelName: `localhost-llm:${LLM_MODEL}`, vendorId: "localhost-llm", desc: "分镜面板生成 - 本地 LLM", temperature: 0.7, maxOutputTokens: 4096 },
    { id: 212, key: "productionAgent:storyboardTableAgent", name: "生产Agent:分镜表格 (本地)", model: LLM_MODEL, modelName: `localhost-llm:${LLM_MODEL}`, vendorId: "localhost-llm", desc: "分镜表格生成 - 本地 LLM", temperature: 0.7, maxOutputTokens: 4096 },
  ];

  for (const agent of childAgents) {
    const exists = await knex("o_agentDeploy").where("key", agent.key).first();
    if (!exists) {
      await knex("o_agentDeploy").insert({
        id: agent.id,
        key: agent.key,
        name: agent.name,
        model: agent.model,
        modelName: agent.modelName,
        vendorId: agent.vendorId,
        desc: agent.desc,
        temperature: agent.temperature,
        maxOutputTokens: agent.maxOutputTokens,
        disabled: false,
      });
      console.log(`[migration] ✅ Registered agent: ${agent.key}`);
    } else {
      await knex("o_agentDeploy").where("key", agent.key).update({
        model: agent.model,
        modelName: agent.modelName,
        vendorId: agent.vendorId,
        temperature: agent.temperature,
        maxOutputTokens: agent.maxOutputTokens,
      });
    }
  }

  // --- 6. 设置 agentUseMode ---
  const useMode = await knex("o_setting").where("key", "agentUseMode").first();
  if (!useMode) {
    await knex("o_setting").insert({ key: "agentUseMode", value: "1" });
    console.log("[migration] ✅ Set agentUseMode = 1 (高级配置)");
  }

  console.log("\n[migration] ✅ 本地 LLM 注册完成！");
  console.log("[migration] 📋 下一步：");
  console.log(`[migration]   1. 确保 llama-server 运行在 ${LLM_BASE_URL}`);
  console.log("[migration]   2. 确保 ComfyUI 运行在 http://localhost:8188");
  console.log("[migration]   3. 在 Toonflow UI 中检查 Agent Deploy 配置");
  console.log(`[migration]   4. 测试文本生成：ai.Text('localhost-llm:${LLM_MODEL}').invoke({ prompt })`);
}

// 如果直接运行此文件
if (require.main === module) {
  (async () => {
    try {
      const knex = require("knex")({
        client: "better-sqlite3",
        connection: {
          filename: "./data/db2.sqlite",
        },
      });

      const vendorDir = path.join(process.cwd(), "data", "vendor");
      await registerLocalHostVendors(knex, vendorDir);

      await knex.destroy();
    } catch (e) {
      console.error("[migration] Error:", e);
      process.exit(1);
    }
  })();
}
