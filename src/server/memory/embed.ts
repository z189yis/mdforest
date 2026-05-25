import { pipeline, env } from "@xenova/transformers";

// 配置模型缓存目录
env.cacheDir = process.env.TRANSFORMERS_CACHE || "./data/models";
env.allowLocalModels = false;

// 支持 Hugging Face 镜像（中国用户可通过 HF_MIRROR 环境变量设置）
// 例如: HF_MIRROR=https://hf-mirror.com
if (process.env.HF_MIRROR) {
  env.remoteHost = process.env.HF_MIRROR;
  console.error(`[memory] Using HF mirror: ${process.env.HF_MIRROR}`);
}

let extractor: any = null;
let initPromise: Promise<any> | null = null;

async function getExtractor() {
  if (extractor) return extractor;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    console.error("[memory] Loading embedding model (all-MiniLM-L6-v2)...");
    const start = Date.now();
    extractor = await pipeline(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2"
    );
    console.error(`[memory] Model loaded in ${Date.now() - start}ms`);
    return extractor;
  })();

  return initPromise;
}

/**
 * 为文本数组生成 embedding 向量
 * @param texts 要编码的文本数组
 * @returns Float32Array 数组，每个长度为 384
 */
export async function embed(texts: string[]): Promise<Float32Array[]> {
  const pipe = await getExtractor();
  const results: Float32Array[] = [];

  // 批处理（避免 OOM）
  const BATCH_SIZE = 32;
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const outputs = await pipe(batch, {
      pooling: "mean",
      normalize: true,
    });
    for (const output of outputs) {
      results.push(new Float32Array(output.data));
    }
  }

  return results;
}
