export type GenerationSetting =
  | { mode: "serverless" }
  | { mode: "server"; url: string; algorithm: string | null };

export async function loadGenerationSetting(): Promise<GenerationSetting> {
  const result = await chrome.storage.local.get("generation");
  const saved = result.generation as GenerationSetting | undefined;
  return saved?.mode === "server" && typeof saved.url === "string"
    ? saved
    : { mode: "serverless" };
}

export async function saveGenerationSetting(generation: GenerationSetting): Promise<void> {
  await chrome.storage.local.set({ generation });
}
