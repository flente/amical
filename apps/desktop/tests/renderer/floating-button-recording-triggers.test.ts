// @vitest-environment jsdom

import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RecordingStatus } from "@/hooks/useRecording";

vi.mock("@/components/RippleWaveform", () => ({
  RippleWaveform: () => null,
}));

vi.mock("@/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ enabled: false }),
}));

const previewSubscription = vi.hoisted(() => ({
  onData: vi.fn<(preview: { sessionId: string; text: string }) => void>(),
}));

vi.mock("@/trpc/react", () => ({
  api: {
    recording: {
      livePreview: {
        useSubscription: (
          _input: unknown,
          options: typeof previewSubscription,
        ) => {
          previewSubscription.onData = options.onData;
        },
      },
    },
    widget: {
      openNotesWindow: {
        useMutation: () => ({ mutateAsync: vi.fn() }),
      },
    },
  },
}));

vi.mock("@/renderer/widget/pass-through", () => ({
  setPassThroughReason: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { FloatingButton } from "@/renderer/widget/pages/widget/components/FloatingButton";

describe("FloatingButton recording triggers", () => {
  it("shows only the current recording preview and clears it across stop/restart", () => {
    const props = {
      recordingStatus: {
        sessionId: "a",
        state: "recording",
        mode: "hands-free",
        isDraft: false,
        stopKind: "none",
        stopOrigin: "none",
      } as RecordingStatus,
      audioLevelRef: { current: 0 },
      startRecording: vi.fn(),
      stopRecording: vi.fn(),
      dismissRecording: vi.fn(),
    };
    const view = render(React.createElement(FloatingButton, props));
    act(() =>
      previewSubscription.onData({ sessionId: "a", text: "日本語の暫定結果" }),
    );
    expect(screen.getByRole("status").textContent).toContain(
      "日本語の暫定結果",
    );
    view.rerender(
      React.createElement(FloatingButton, {
        ...props,
        recordingStatus: { ...props.recordingStatus, state: "stopping" },
      }),
    );
    expect(screen.queryByRole("status")).toBeNull();
    view.rerender(
      React.createElement(FloatingButton, {
        ...props,
        recordingStatus: { ...props.recordingStatus, sessionId: "b" },
      }),
    );
    act(() => previewSubscription.onData({ sessionId: "a", text: "stale" }));
    expect(screen.queryByRole("status")).toBeNull();
  });
  it.each([
    {
      state: "recording",
      button: "Dismiss recording",
      expected: "dismiss",
    },
    {
      state: "starting",
      button: "Dismiss recording",
      expected: "dismiss",
    },
    {
      state: "recording",
      button: "Stop recording and transcribe",
      expected: "stop",
    },
    {
      state: "starting",
      button: "Stop recording and transcribe",
      expected: "stop",
    },
  ] as const)(
    "I-51 routes $button while $state",
    ({ state, button, expected }) => {
      const startRecording = vi.fn().mockResolvedValue(undefined);
      const stopRecording = vi.fn().mockResolvedValue(undefined);
      const dismissRecording = vi.fn().mockResolvedValue(undefined);
      const recordingStatus: RecordingStatus = {
        sessionId: "session-1",
        state,
        mode: "hands-free",
        isDraft: false,
        stopKind: "none",
        stopOrigin: "none",
      };

      render(
        React.createElement(FloatingButton, {
          recordingStatus,
          audioLevelRef: { current: 0 },
          startRecording,
          stopRecording,
          dismissRecording,
        }),
      );

      fireEvent.click(screen.getByRole("button", { name: button }));

      expect(stopRecording).toHaveBeenCalledTimes(expected === "stop" ? 1 : 0);
      expect(dismissRecording).toHaveBeenCalledTimes(
        expected === "dismiss" ? 1 : 0,
      );
      expect(startRecording).not.toHaveBeenCalled();
    },
  );
});
