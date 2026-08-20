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
