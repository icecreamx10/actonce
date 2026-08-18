export const ANDROID_WORLD_MODEL_PROFILES = {
  "codex-luna": {
    id: "codex-luna",
    provider: "codex-app-server",
    model: "gpt-5.6-luna",
    family: "gpt-5",
    reasoning: {
      enabled: true,
      effort: "medium",
    },
    env: {
      MIDSCENE_MODEL_BASE_URL: "codex://",
      MIDSCENE_MODEL_NAME: "gpt-5.6-luna",
      MIDSCENE_MODEL_FAMILY: "gpt-5",
      MIDSCENE_MODEL_REASONING_ENABLED: "true",
      MIDSCENE_MODEL_REASONING_EFFORT: "medium",
      MIDSCENE_MODEL_TIMEOUT: "600000",
      MIDSCENE_RECORD_MODEL_CALL: "1",
      MIDSCENE_REPLANNING_CYCLE_LIMIT: "120",
    },
  },
  // Volcengine ARK Doubao endpoint used as the Luna replacement when the
  // codex-app-server route is unavailable. Non-secret routing only: the
  // endpoint id resolves to doubao-seed-2-1-pro-260628. MIDSCENE_MODEL_API_KEY
  // is intentionally NOT stored here — it is supplied from the environment
  // (`.env`) at run time so this profile stays key-free for safe provenance.
  "ark-doubao": {
    id: "ark-doubao",
    provider: "volcengine-ark",
    model: "doubao-seed-2-1-pro-260628",
    family: "doubao-seed",
    reasoning: {
      enabled: false,
      effort: "none",
    },
    env: {
      MIDSCENE_MODEL_BASE_URL: "https://ark-cn-beijing.bytedance.net/api/v3",
      MIDSCENE_MODEL_NAME: "ep-20260721211518-8k2xk",
      MIDSCENE_MODEL_FAMILY: "doubao-seed",
      MIDSCENE_MODEL_TIMEOUT: "600000",
      MIDSCENE_RECORD_MODEL_CALL: "1",
      MIDSCENE_REPLANNING_CYCLE_LIMIT: "120",
    },
  },
} as const;

export type AndroidWorldModelProfile = keyof typeof ANDROID_WORLD_MODEL_PROFILES;

export function requireAndroidWorldModelProfile(value: string) {
  const profile = ANDROID_WORLD_MODEL_PROFILES[value as AndroidWorldModelProfile];
  if (!profile) {
    throw new Error(
      `Unknown AndroidWorld model profile: ${value}. Available: ${Object.keys(ANDROID_WORLD_MODEL_PROFILES).join(", ")}`,
    );
  }
  return profile;
}

export function modelProfileProvenance(value: string) {
  const profile = requireAndroidWorldModelProfile(value);
  return {
    profile: profile.id,
    provider: profile.provider,
    model: profile.model,
    family: profile.family,
    reasoning: profile.reasoning,
  };
}
