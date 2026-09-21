import assert from "node:assert/strict";
import { describe, test } from "node:test";

const g = globalThis as typeof globalThis & { document?: { fullscreenElement: Element | null } };
if (!g.document) {
  g.document = { fullscreenElement: null };
}
import { mediaResponseHeaders, mediaStatus } from "../../lib/mediaDelivery.ts";
import {
  attachTeachingSource,
  enterTeachingFullscreen,
  isTeachingFullscreen,
  markTeachingVideoInline,
  playTeachingVideo,
  prepareTeachingPlayback,
  stopTeachingBuffering,
} from "../../lib/store/teachingPlayer.ts";

describe("teaching player helpers", () => {
  test("marks iOS inline attributes without disabling fullscreen", () => {
    const node = makeVideo();
    markTeachingVideoInline(node);
    assert.equal(node.getAttribute("playsinline"), "");
    assert.equal(node.getAttribute("webkit-playsinline"), "");
    assert.equal(node.playsInline, true);
    assert.equal(node.getAttribute("controlsList"), null);
  });

  test("attaches the full source once and can stop buffering without dropping progress", () => {
    const node = makeVideo();
    assert.equal(attachTeachingSource(node, "/media/full.mp4", "metadata"), true);
    assert.equal(node.getAttribute("src"), "/media/full.mp4");
    assert.equal(node.preload, "metadata");
    assert.equal(attachTeachingSource(node, "/media/full.mp4", "metadata"), false);
    node.currentTime = 12;
    stopTeachingBuffering(node, false);
    assert.equal(node.paused, true);
    assert.equal(node.preload, "none");
    assert.equal(node.getAttribute("src"), "/media/full.mp4");
    stopTeachingBuffering(node, true);
    assert.equal(node.getAttribute("src"), null);
  });

  test("prepare + play stay on the same element and enable native controls", async () => {
    const node = makeVideo();
    attachTeachingSource(node, "/media/full.mp4", "metadata");
    prepareTeachingPlayback(node, "/media/full.mp4");
    assert.equal(node.controls, true);
    assert.equal(node.muted, false);
    assert.equal(node.loop, false);
    node.playImpl = async () => {
      node.paused = false;
    };
    assert.equal(await playTeachingVideo(node), "playing");
    assert.equal(node.playCalls, 1);
    node.playImpl = async () => {
      throw new Error("NotAllowedError");
    };
    node.paused = false;
    assert.equal(await playTeachingVideo(node), "paused");
    assert.equal(node.controls, true);
    assert.equal(node.paused, true);
  });

  test("fullscreen helper prefers requestFullscreen and falls back to webkit", async () => {
    const node = makeVideo();
    node.requestFullscreen = async () => {
      documentFullscreen(node);
    };
    assert.equal(await enterTeachingFullscreen(node), true);
    assert.equal(isTeachingFullscreen(node), true);

    const safari = makeVideo();
    delete (safari as { requestFullscreen?: unknown }).requestFullscreen;
    let entered = false;
    (safari as { webkitEnterFullscreen: () => void }).webkitEnterFullscreen = () => {
      entered = true;
      (safari as { webkitDisplayingFullscreen: boolean }).webkitDisplayingFullscreen = true;
    };
    assert.equal(await enterTeachingFullscreen(safari), true);
    assert.equal(entered, true);
    assert.equal(isTeachingFullscreen(safari), true);
  });
});

describe("media range delivery", () => {
  test("range + Content-Range is 206 with Accept-Ranges and Content-Range", () => {
    assert.equal(mediaStatus("bytes=0-1023", "bytes 0-1023/4096"), 206);
    assert.equal(mediaStatus(undefined, undefined), 200);
    assert.equal(mediaStatus("bytes=0-1", undefined), 200);
    const headers = mediaResponseHeaders({
      contentType: "video/mp4",
      contentLength: 1024,
      contentRange: "bytes 0-1023/4096",
      etag: '"abc"',
    });
    assert.equal(headers.get("Accept-Ranges"), "bytes");
    assert.equal(headers.get("Content-Range"), "bytes 0-1023/4096");
    assert.equal(headers.get("Content-Type"), "video/mp4");
    assert.equal(headers.get("Content-Length"), "1024");
    assert.equal(headers.get("Cache-Control"), "public, max-age=31536000, immutable");
    assert.equal(headers.get("Vercel-CDN-Cache-Control"), "public, max-age=31536000, immutable");
    assert.equal(headers.get("Vary"), "Range");
  });
});

function documentFullscreen(node: HTMLVideoElement) {
  Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => node });
}

function makeVideo(): HTMLVideoElement & {
  playCalls: number;
  playImpl?: () => Promise<void>;
} {
  const attrs = new Map<string, string>();
  const node: Record<string, unknown> = {
    paused: true,
    muted: true,
    defaultMuted: true,
    loop: true,
    controls: false,
    playsInline: false,
    preload: "none",
    currentTime: 0,
    playCalls: 0,
    playImpl: async () => {
      node.paused = false;
    },
    getAttribute(name: string) {
      return attrs.has(name) ? attrs.get(name)! : null;
    },
    setAttribute(name: string, value: string) {
      attrs.set(name, value);
    },
    removeAttribute(name: string) {
      attrs.delete(name);
    },
    load() {},
    pause() {
      node.paused = true;
    },
    play() {
      node.playCalls = Number(node.playCalls) + 1;
      const impl = node.playImpl as undefined | (() => Promise<void>);
      return impl ? impl() : Promise.resolve();
    },
  };
  Object.defineProperty(node, "src", {
    get() {
      return attrs.get("src") || "";
    },
    set(value: string) {
      attrs.set("src", value);
    },
    configurable: true,
  });
  return node as unknown as HTMLVideoElement & { playCalls: number; playImpl?: () => Promise<void> };
}
