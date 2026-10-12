export function cleanUrl(url: string | null | undefined): string {
  if (!url) return "";
  const match = url.match(/^(?:https?:\/\/)([^/?#]+)(?:[/?#]|$)/i);
  return match?.[1] ?? "";
}

export function activeTabSite(): Promise<string> {
  return new Promise((resolve) => {
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        resolve(cleanUrl(tabs[0]?.url));
      });
    } catch {
      resolve("");
    }
  });
}
