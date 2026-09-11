class AudioManager {
  private activeAudios: Map<string, HTMLAudioElement> = new Map();
  private audioTimeouts: Map<string, number> = new Map();
  private readonly maxAudioDuration = 600000;

  private storageUrl(virtualPath: string): string {
    return `/api/storage/file?path=${encodeURIComponent(virtualPath)}`;
  }

  private normalizeFileName(fileName: string): string[] {
    const normalized = fileName.trim();

    if (!normalized) return [];

    if (
      normalized.startsWith("http://") ||
      normalized.startsWith("https://") ||
      normalized.startsWith("blob:") ||
      normalized.startsWith("data:")
    ) {
      return [normalized];
    }

    if (normalized.startsWith("/api/storage/file")) {
      return [normalized];
    }

    if (normalized.startsWith("/sd/") || normalized === "/sd") {
      return [this.storageUrl(normalized)];
    }

    if (normalized.startsWith("/flash/") || normalized === "/flash") {
      return [this.storageUrl(normalized)];
    }

    if (normalized.startsWith("/audio/")) {
      return [normalized];
    }

    if (normalized.startsWith("/")) {
      return [normalized];
    }

    // New Hub default: plain legacy names such as "horn.mp3" resolve to
    // /sd/audio/horn.mp3. Keep the original /audio/<name> URL as a fallback so
    // layouts created before SD support continue to work with LittleFS builds.
    return [
      this.storageUrl(`/sd/audio/${normalized}`),
      `/audio/${normalized}`,
    ];
  }

  play(
    fileName: string,
    options?: {
      onEnded?: () => void;
      onError?: (error: unknown) => void;
    }
  ) {
    const candidates = this.normalizeFileName(fileName);

    if (candidates.length === 0) {
      console.warn("[AudioManager] Missing audio filename");
      return;
    }

    let candidateIndex = 0;
    let audio: HTMLAudioElement | null = null;
    let activeUrl = "";
    let finished = false;

    const cleanup = () => {
      if (activeUrl) {
        this.activeAudios.delete(activeUrl);
        this.clearAudioTimeout(activeUrl);
      }
    };

    const fail = (error: unknown) => {
      if (finished) return;
      finished = true;
      cleanup();
      console.error("[AudioManager] Audio play error:", error);
      options?.onError?.(error);
    };

    const startCandidate = () => {
      if (candidateIndex >= candidates.length) {
        fail(new Error(`Audio load/play error: ${fileName}`));
        return;
      }

      const url = candidates[candidateIndex];
      candidateIndex += 1;

      if (!url) {
        fail(new Error(`Audio load/play error: ${fileName}`));
        return;
      }

      if (this.activeAudios.has(url)) {
        this.stop(url);
      }

      cleanup();
      activeUrl = url;
      audio = new Audio(url);

      audio.onended = () => {
        if (finished) return;
        finished = true;
        cleanup();
        options?.onEnded?.();
      };

      audio.onerror = () => {
        cleanup();

        if (candidateIndex < candidates.length) {
          startCandidate();
          return;
        }

        fail(new Error(`Audio load/play error: ${url}`));
      };

      this.activeAudios.set(url, audio);

      const timeoutId = window.setTimeout(() => {
        if (audio) {
          audio.pause();
          audio.currentTime = 0;
        }
        fail(new Error(`Audio playback timeout: ${url}`));
      }, this.maxAudioDuration);

      this.audioTimeouts.set(url, timeoutId);

      audio.play().catch((error) => {
        cleanup();

        if (candidateIndex < candidates.length) {
          startCandidate();
          return;
        }

        fail(error);
      });
    };

    startCandidate();
    return audio ?? undefined;
  }

  stop(fileName: string) {
    const urls = this.normalizeFileName(fileName);

    for (const url of urls) {
      const audio = this.activeAudios.get(url);

      if (!audio) continue;

      audio.pause();
      audio.currentTime = 0;
      this.activeAudios.delete(url);
      this.clearAudioTimeout(url);
    }
  }

  stopAll() {
    for (const audio of this.activeAudios.values()) {
      audio.pause();
      audio.currentTime = 0;
    }

    this.activeAudios.clear();

    for (const timeoutId of this.audioTimeouts.values()) {
      clearTimeout(timeoutId);
    }

    this.audioTimeouts.clear();
  }

  private clearAudioTimeout(url: string) {
    const timeoutId = this.audioTimeouts.get(url);

    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
      this.audioTimeouts.delete(url);
    }
  }
}

export const audioManager = new AudioManager();
