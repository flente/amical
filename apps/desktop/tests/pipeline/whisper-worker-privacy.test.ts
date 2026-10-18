import { afterEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  load: vi.fn(async () => {}),
  free: vi.fn(async () => {}),
  transcribe: vi.fn(async () => ({
    result: Promise.resolve([
      { text: "PRIVATE_PREVIEW_TEXT", noSpeechProb: 0 },
    ]),
  })),
}));
vi.mock("@amical/whisper-wrapper", () => ({
  Whisper: class {
    load = native.load;
    free = native.free;
    transcribe = native.transcribe;
  },
}));
vi.mock(
  "../../src/pipeline/providers/transcription/whisper-gpu-policy",
  () => ({
    resolveWhisperGpuDecision: async () => ({
      useGpu: false,
      reason: "synthetic test",
    }),
  }),
);
vi.mock("../../src/pipeline/utils/segment-filter", () => ({
  shouldDropSegment: () => false,
}));

afterEach(() => vi.restoreAllMocks());

describe("Whisper worker preview privacy", () => {
  it("returns the hypothesis over IPC without including it in log messages", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(process, "send");
    const send = vi.fn();
    const existing = new Set(process.listeners("message"));
    Object.defineProperty(process, "send", {
      configurable: true,
      writable: true,
      value: send,
    });
    let handler: ((message: unknown) => Promise<void>) | undefined;
    try {
      await import(
        "../../src/pipeline/providers/transcription/whisper-worker-fork"
      );
      handler = process
        .listeners("message")
        .find((listener) => !existing.has(listener)) as typeof handler;
      expect(handler).toBeTypeOf("function");
      await handler!({
        id: 1,
        method: "initializeModel",
        args: ["/synthetic/model.bin"],
      });
      send.mockClear();
      const audio = new Float32Array(32000);
      const options = {
        initial_prompt: "PRIVATE_PROMPT",
        suppress_blank: true,
        suppress_non_speech_tokens: true,
        no_timestamps: false,
      };
      await handler!({
        id: 2,
        method: "transcribeAudio",
        args: [audio, options, { logContent: false }],
      });
      expect(send).toHaveBeenCalledWith({
        id: 2,
        result: { text: "PRIVATE_PREVIEW_TEXT", detectedLanguage: undefined },
      });
      expect(native.transcribe).toHaveBeenCalledWith(audio, {
        ...options,
        print_realtime: false,
        print_timestamps: false,
        print_progress: false,
      });
      const logs = send.mock.calls
        .map(([message]) => message)
        .filter((message) => message.type === "log");
      expect(JSON.stringify(logs)).not.toContain("PRIVATE_PREVIEW_TEXT");
      expect(JSON.stringify(logs)).not.toContain("PRIVATE_PROMPT");
      // Existing final-recognition diagnostics remain available.
      send.mockClear();
      await handler!({
        id: 3,
        method: "transcribeAudio",
        args: [audio, options],
      });
      expect(
        send.mock.calls.some(
          ([message]) =>
            message.type === "log" &&
            message.message.includes("PRIVATE_PREVIEW_TEXT"),
        ),
      ).toBe(true);
    } finally {
      if (handler) process.off("message", handler);
      if (descriptor) Object.defineProperty(process, "send", descriptor);
      else Reflect.deleteProperty(process, "send");
    }
  });
});
