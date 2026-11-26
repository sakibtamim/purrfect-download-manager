import React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DownloadContextMenu,
  clampPosition,
  getDownloadContextMenuActions,
} from "./download-context-menu";
import { Aria2Download } from "@/lib/aria2Client";

describe("DownloadContextMenu - clampPosition", () => {
  it("keeps coordinates unchanged when well within viewport limits", () => {
    const pos = { x: 100, y: 150 };
    const dimensions = { width: 220, height: 300 };
    const viewport = { width: 1920, height: 1080 };
    const clamped = clampPosition(pos, dimensions, viewport, 8);
    expect(clamped).toEqual({ x: 100, y: 150 });
  });

  it("clamps X coordinate to prevent clipping past the right edge", () => {
    const pos = { x: 1800, y: 100 };
    const dimensions = { width: 220, height: 300 };
    const viewport = { width: 1920, height: 1080 };
    const clamped = clampPosition(pos, dimensions, viewport, 8);
    // 1920 - 220 - 8 = 1692
    expect(clamped.x).toBe(1692);
    expect(clamped.y).toBe(100);
  });

  it("clamps Y coordinate to prevent clipping past the bottom edge", () => {
    const pos = { x: 100, y: 900 };
    const dimensions = { width: 220, height: 300 };
    const viewport = { width: 1920, height: 1080 };
    const clamped = clampPosition(pos, dimensions, viewport, 8);
    // 1080 - 300 - 8 = 772
    expect(clamped.x).toBe(100);
    expect(clamped.y).toBe(772);
  });

  it("clamps negative coordinates to minimum padding", () => {
    const pos = { x: -50, y: -20 };
    const dimensions = { width: 220, height: 300 };
    const viewport = { width: 1920, height: 1080 };
    const clamped = clampPosition(pos, dimensions, viewport, 10);
    expect(clamped).toEqual({ x: 10, y: 10 });
  });

  it("handles viewports smaller than menu dimensions safely", () => {
    const pos = { x: 100, y: 100 };
    const dimensions = { width: 300, height: 400 };
    const viewport = { width: 200, height: 200 };
    const clamped = clampPosition(pos, dimensions, viewport, 8);
    expect(clamped.x).toBe(8);
    expect(clamped.y).toBe(8);
  });
});

describe("DownloadContextMenu - getDownloadContextMenuActions", () => {
  const baseDownload: Aria2Download = {
    gid: "gid-123",
    status: "active",
    totalLength: "104857600",
    completedLength: "52428800",
    downloadSpeed: "1048576",
    dir: "/home/user/Downloads",
    files: [
      {
        path: "/home/user/Downloads/video.mp4",
        length: "104857600",
        completedLength: "52428800",
        uris: [{ status: "used", uri: "https://example.com/video.mp4" }],
      },
    ],
  };

  it("configures active downloads correctly (standard & playful)", () => {
    const actionsNormal = getDownloadContextMenuActions(baseDownload, { isPlayfulMode: false });
    expect(actionsNormal.canPause).toBe(true);
    expect(actionsNormal.canResume).toBe(false);
    expect(actionsNormal.pauseLabel).toBe("Pause");

    const actionsPlayful = getDownloadContextMenuActions(baseDownload, { isPlayfulMode: true });
    expect(actionsPlayful.canPause).toBe(true);
    expect(actionsPlayful.pauseLabel).toBe("Put to Sleep 💤");
  });

  it("configures paused & waiting downloads correctly", () => {
    const pausedDownload = { ...baseDownload, status: "paused" as const };
    const actionsPaused = getDownloadContextMenuActions(pausedDownload, { isPlayfulMode: false });
    expect(actionsPaused.canPause).toBe(false);
    expect(actionsPaused.canResume).toBe(true);
    expect(actionsPaused.resumeLabel).toBe("Resume");

    const waitingDownload = { ...baseDownload, status: "waiting" as const };
    const actionsWaiting = getDownloadContextMenuActions(waitingDownload, { isPlayfulMode: true });
    expect(actionsWaiting.canResume).toBe(true);
    expect(actionsWaiting.resumeLabel).toBe("Wake Up & Pounce 🐾");
  });

  it("configures complete downloads with existing file", () => {
    const completeDownload = { ...baseDownload, status: "complete" as const };
    const actions = getDownloadContextMenuActions(completeDownload, { isPlayfulMode: false });
    expect(actions.canOpenFile).toBe(true);
    expect(actions.openFileLabel).toBe("Open File");
    expect(actions.canOpenFolder).toBe(true);
    expect(actions.filePath).toBe("/home/user/Downloads/video.mp4");
    expect(actions.downloadUrl).toBe("https://example.com/video.mp4");
  });

  it("disables Open File and marks hasMissingFile when fileMissing is true", () => {
    const missingDownload = { ...baseDownload, status: "complete" as const, fileMissing: true };
    const actions = getDownloadContextMenuActions(missingDownload);
    expect(actions.canOpenFile).toBe(false);
    expect(actions.hasMissingFile).toBe(true);
    expect(actions.canRedownload).toBe(true);
  });

  it("disables pause/resume/open during muxing", () => {
    const muxingDownload = { ...baseDownload, status: "muxing" as const, muxProgress: 45 };
    const actions = getDownloadContextMenuActions(muxingDownload);
    expect(actions.canPause).toBe(false);
    expect(actions.canResume).toBe(false);
    expect(actions.canOpenFile).toBe(false);
  });

  it("allows redownload and delete for error/removed downloads", () => {
    const errorDownload = { ...baseDownload, status: "error" as const };
    const actions = getDownloadContextMenuActions(errorDownload);
    expect(actions.canPause).toBe(false);
    expect(actions.canResume).toBe(false);
    expect(actions.canRedownload).toBe(true);
  });
});

describe("DownloadContextMenu - Component Rendering", () => {
  const baseDownload: Aria2Download = {
    gid: "gid-test",
    status: "active",
    totalLength: "5000",
    completedLength: "2500",
    downloadSpeed: "1000",
    dir: "/downloads",
    files: [
      {
        path: "/downloads/file.zip",
        length: "5000",
        completedLength: "2500",
        uris: [{ status: "used", uri: "https://example.com/file.zip" }],
      },
    ],
  };

  it("renders nothing when position is null or download is null", () => {
    const noPos = renderToStaticMarkup(
      <DownloadContextMenu download={baseDownload} position={null} onClose={vi.fn()} />
    );
    expect(noPos).toBe("");

    const noDl = renderToStaticMarkup(
      <DownloadContextMenu download={null} position={{ x: 100, y: 100 }} onClose={vi.fn()} />
    );
    expect(noDl).toBe("");
  });

  it("renders Pause item for active downloads", () => {
    const html = renderToStaticMarkup(
      <DownloadContextMenu
        download={baseDownload}
        position={{ x: 200, y: 200 }}
        onClose={vi.fn()}
        isPlayfulMode={false}
      />
    );
    expect(html).toContain("Pause");
    expect(html).not.toContain("Resume");
    expect(html).toContain("Open Destination Folder");
    expect(html).toContain("Redownload");
    expect(html).toContain("Copy Download Link");
    expect(html).toContain("Copy File Path");
    expect(html).toContain("View Details");
    expect(html).toContain("Remove / Delete...");
  });

  it("renders Resume item for paused downloads", () => {
    const pausedDownload = { ...baseDownload, status: "paused" as const };
    const html = renderToStaticMarkup(
      <DownloadContextMenu
        download={pausedDownload}
        position={{ x: 200, y: 200 }}
        onClose={vi.fn()}
        isPlayfulMode={false}
      />
    );
    expect(html).toContain("Resume");
    expect(html).not.toContain("Pause");
  });

  it("renders Open File for completed downloads", () => {
    const completeDownload = { ...baseDownload, status: "complete" as const };
    const html = renderToStaticMarkup(
      <DownloadContextMenu
        download={completeDownload}
        position={{ x: 200, y: 200 }}
        onClose={vi.fn()}
        isPlayfulMode={false}
      />
    );
    expect(html).toContain("Open File");
  });

  it("renders Missing badge and hides Open File when fileMissing is true", () => {
    const missingDownload = { ...baseDownload, status: "complete" as const, fileMissing: true };
    const html = renderToStaticMarkup(
      <DownloadContextMenu
        download={missingDownload}
        position={{ x: 200, y: 200 }}
        onClose={vi.fn()}
        isPlayfulMode={false}
      />
    );
    expect(html).not.toContain("Open File");
    expect(html).toContain("Missing");
  });

  it("renders playful labels when isPlayfulMode is true", () => {
    const activeHtml = renderToStaticMarkup(
      <DownloadContextMenu
        download={baseDownload}
        position={{ x: 200, y: 200 }}
        onClose={vi.fn()}
        isPlayfulMode={true}
      />
    );
    expect(activeHtml).toContain("Put to Sleep 💤");

    const pausedHtml = renderToStaticMarkup(
      <DownloadContextMenu
        download={{ ...baseDownload, status: "paused" as const }}
        position={{ x: 200, y: 200 }}
        onClose={vi.fn()}
        isPlayfulMode={true}
      />
    );
    expect(pausedHtml).toContain("Wake Up");
    expect(pausedHtml).toContain("Pounce 🐾");
  });
});
