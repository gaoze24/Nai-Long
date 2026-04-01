const MEDIA_CONFIG = {
  videoSrc: "./assets/character.mp4",
  audioSrc: "./assets/character-audio.mp3",
  preferExternalAudio: true,
  defaultPlaybackRate: 1,
  defaultVolume: 1,
  syncThresholdSeconds: 0.18,
  syncIntervalMs: 260,
  initialReadyTimeoutMs: 10000,
  playReadyTimeoutMs: 9000,
  audioReadyTimeoutMs: 6000,
  sourceProbeTimeoutMs: 5000,
};

const state = {
  isPlaying: false,
  isLoading: true,
  hasFatalError: false,
  useExternalAudio: MEDIA_CONFIG.preferExternalAudio,
  syncTimerId: null,
  initialLoadWatchdogId: null,
};

const elements = {
  video: document.getElementById("characterVideo"),
  audio: document.getElementById("characterAudio"),
  playButton: document.getElementById("playButton"),
  playButtonLabel: document.getElementById("playButtonLabel"),
  loadingOverlay: document.getElementById("loadingOverlay"),
  loadingText: document.getElementById("loadingText"),
  errorMessage: document.getElementById("errorMessage"),
};

initializeApp();

function initializeApp() {
  enforceMobileInlinePlayback();

  elements.video.src = MEDIA_CONFIG.videoSrc;
  elements.audio.src = MEDIA_CONFIG.audioSrc;

  elements.video.playbackRate = MEDIA_CONFIG.defaultPlaybackRate;
  elements.audio.playbackRate = MEDIA_CONFIG.defaultPlaybackRate;
  elements.video.volume = MEDIA_CONFIG.defaultVolume;
  elements.audio.volume = MEDIA_CONFIG.defaultVolume;

  wireMediaEvents();
  wireUiEvents();
  applyAudioRouting();
  render();

  logCodecCompatibilityHints();
  startInitialLoadWatchdog();

  elements.video.load();
  elements.audio.load();

  void probeMediaSources();
}

function wireMediaEvents() {
  const onVideoReady = (event) => {
    console.info(`[media] video ready via ${event.type}`, getMediaDebugSnapshot(elements.video));
    clearInitialLoadWatchdog();
    clearNonFatalError();
    setLoading(false);
  };

  elements.video.addEventListener("loadedmetadata", onVideoReady);
  elements.video.addEventListener("loadeddata", onVideoReady);
  elements.video.addEventListener("canplay", onVideoReady);

  elements.video.addEventListener("waiting", () => {
    console.warn("[media] video waiting", getMediaDebugSnapshot(elements.video));

    if (state.isPlaying) {
      setLoading(true, "Buffering media...");
    }
  });

  elements.video.addEventListener("stalled", () => {
    console.warn("[media] video stalled", getMediaDebugSnapshot(elements.video));
  });

  elements.video.addEventListener("suspend", () => {
    console.warn("[media] video suspend", getMediaDebugSnapshot(elements.video));
  });

  elements.video.addEventListener("playing", () => {
    setLoading(false);
  });

  elements.video.addEventListener("pause", () => {
    if (!elements.video.ended && !state.hasFatalError) {
      state.isPlaying = false;
      stopSyncLoop();
      renderPlayButton();
    }
  });

  elements.video.addEventListener("ended", () => {
    pauseEverything();
    elements.video.currentTime = 0;
    if (state.useExternalAudio) {
      elements.audio.currentTime = 0;
    }
  });

  elements.video.addEventListener("seeking", () => {
    syncAudioToVideo();
  });

  elements.video.addEventListener("ratechange", () => {
    if (state.useExternalAudio) {
      elements.audio.playbackRate = elements.video.playbackRate;
    }
  });

  elements.video.addEventListener("error", () => {
    console.error("[media] video error", getMediaDebugSnapshot(elements.video));
    showFatalError(buildVideoErrorMessage());
  });

  elements.audio.addEventListener("error", () => {
    console.error("[media] audio error", getMediaDebugSnapshot(elements.audio));

    if (state.useExternalAudio) {
      disableExternalAudio(
        "External audio failed to load. Using video audio only.",
      );
    }
  });
}

function wireUiEvents() {
  elements.playButton.addEventListener("click", handlePlayToggle);
}

async function handlePlayToggle() {
  if (state.hasFatalError) {
    return;
  }

  if (state.isPlaying) {
    pauseEverything();
    return;
  }

  await startPlaybackFromGesture();
}

/*
  Media playback logic:
  This function only runs from a direct user click/tap, satisfying browser
  gesture policies for starting media with sound.
*/
async function startPlaybackFromGesture() {
  clearNonFatalError();
  setLoading(true, "Preparing media...");

  try {
    await waitForMediaReady(
      elements.video,
      MEDIA_CONFIG.playReadyTimeoutMs,
      "video",
    );

    applyAudioRouting();

    if (state.useExternalAudio) {
      await alignAudioWithVideo();
      await Promise.all([elements.video.play(), elements.audio.play()]);
      startSyncLoop();
    } else {
      await elements.video.play();
      stopSyncLoop();
    }

    state.isPlaying = true;
    setLoading(false);
    renderPlayButton();
  } catch (error) {
    await handlePlaybackStartError(error);
  }
}

async function handlePlaybackStartError(error) {
  console.error("[media] playback start failed", error);

  if (state.useExternalAudio) {
    disableExternalAudio(
      "External audio is unavailable on this device/session. Falling back to video audio.",
      true,
    );

    try {
      await elements.video.play();
      state.isPlaying = true;
      setLoading(false);
      renderPlayButton();
      return;
    } catch (videoOnlyError) {
      console.warn("Video-only fallback failed:", videoOnlyError);
    }
  }

  state.isPlaying = false;
  setLoading(false);
  showNonFatalMediaMessage(
    "Could not start playback. Check media path/format and try again.",
  );
  renderPlayButton();
}

function pauseEverything() {
  elements.video.pause();
  elements.audio.pause();
  state.isPlaying = false;
  stopSyncLoop();
  renderPlayButton();
}

function applyAudioRouting() {
  // Avoid double audio output when a separate track is active.
  elements.video.muted = state.useExternalAudio;
}

async function alignAudioWithVideo() {
  if (!state.useExternalAudio) {
    return;
  }

  await waitForMediaReady(
    elements.audio,
    MEDIA_CONFIG.audioReadyTimeoutMs,
    "audio",
  );

  elements.audio.currentTime = safeCurrentTime(elements.video.currentTime, elements.audio.duration);
}

/*
  Sync logic:
  During external-audio mode, periodically compare timestamps and correct drift
  only when the delta is meaningful to keep playback stable and avoid jitter.
*/
function startSyncLoop() {
  stopSyncLoop();

  if (!state.useExternalAudio) {
    return;
  }

  state.syncTimerId = window.setInterval(() => {
    if (!state.isPlaying) {
      return;
    }

    syncAudioToVideo();
  }, MEDIA_CONFIG.syncIntervalMs);
}

function stopSyncLoop() {
  if (state.syncTimerId) {
    window.clearInterval(state.syncTimerId);
    state.syncTimerId = null;
  }
}

function syncAudioToVideo() {
  if (!state.useExternalAudio || !Number.isFinite(elements.audio.duration)) {
    return;
  }

  const drift = elements.video.currentTime - elements.audio.currentTime;
  const driftAbs = Math.abs(drift);

  if (driftAbs < MEDIA_CONFIG.syncThresholdSeconds) {
    return;
  }

  elements.audio.currentTime = safeCurrentTime(elements.video.currentTime, elements.audio.duration);
}

function waitForMediaReady(mediaElement, timeoutMs, label) {
  if (mediaElement.readyState >= 1) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `Timed out waiting for ${label} readiness. ${formatMediaState(mediaElement)}`,
        ),
      );
    }, timeoutMs);

    const onReady = (event) => {
      cleanup();
      console.info(`[media] ${label} ready via ${event.type}`, getMediaDebugSnapshot(mediaElement));
      resolve();
    };

    const onError = () => {
      cleanup();
      reject(
        new Error(
          `${label} failed while waiting for readiness. ${formatMediaState(mediaElement)}`,
        ),
      );
    };

    function cleanup() {
      window.clearTimeout(timeoutId);
      mediaElement.removeEventListener("loadedmetadata", onReady);
      mediaElement.removeEventListener("loadeddata", onReady);
      mediaElement.removeEventListener("canplay", onReady);
      mediaElement.removeEventListener("error", onError);
    }

    mediaElement.addEventListener("loadedmetadata", onReady, { once: true });
    mediaElement.addEventListener("loadeddata", onReady, { once: true });
    mediaElement.addEventListener("canplay", onReady, { once: true });
    mediaElement.addEventListener("error", onError, { once: true });
  });
}

function safeCurrentTime(nextTime, duration) {
  if (!Number.isFinite(duration) || duration <= 0) {
    return Math.max(nextTime, 0);
  }

  return Math.min(Math.max(nextTime, 0), Math.max(duration - 0.02, 0));
}

function showFatalError(message) {
  state.hasFatalError = true;
  state.isPlaying = false;
  clearInitialLoadWatchdog();
  stopSyncLoop();
  elements.errorMessage.textContent = message;
  elements.errorMessage.hidden = false;
  elements.playButton.disabled = true;
  setLoading(false);
  renderPlayButton();
}

function clearNonFatalError() {
  if (!state.hasFatalError) {
    elements.errorMessage.hidden = true;
  }
}

function showNonFatalMediaMessage(message) {
  if (state.hasFatalError) {
    return;
  }

  elements.errorMessage.textContent = message;
  elements.errorMessage.hidden = false;
}

function setLoading(isLoading, text = "Loading media...") {
  state.isLoading = isLoading;
  elements.loadingText.textContent = text;
  elements.loadingOverlay.classList.toggle("is-hidden", !isLoading);
}

function renderPlayButton() {
  elements.playButton.classList.toggle("is-playing", state.isPlaying);
  elements.playButton.setAttribute("aria-pressed", String(state.isPlaying));
  elements.playButton.setAttribute(
    "aria-label",
    state.isPlaying ? "闭嘴" : "开始笑",
  );
  elements.playButtonLabel.textContent = state.isPlaying ? "闭嘴" : "开始笑";
}

function render() {
  renderPlayButton();
  setLoading(state.isLoading);
}

function enforceMobileInlinePlayback() {
  // iOS Safari needs explicit inline hints to avoid fullscreen-only playback behavior.
  elements.video.setAttribute("playsinline", "");
  elements.video.setAttribute("webkit-playsinline", "");
  elements.video.playsInline = true;
}

function startInitialLoadWatchdog() {
  clearInitialLoadWatchdog();

  state.initialLoadWatchdogId = window.setTimeout(() => {
    if (!state.isLoading || state.hasFatalError) {
      return;
    }

    console.warn(
      "[media] initial load timeout",
      getMediaDebugSnapshot(elements.video),
    );

    if (elements.video.error) {
      showFatalError(buildVideoErrorMessage());
      return;
    }

    setLoading(false);
    showNonFatalMediaMessage(
      "Media is taking too long to load. Tap play to retry, and verify MP4 (H.264/AAC) compatibility.",
    );
  }, MEDIA_CONFIG.initialReadyTimeoutMs);
}

function clearInitialLoadWatchdog() {
  if (state.initialLoadWatchdogId) {
    window.clearTimeout(state.initialLoadWatchdogId);
    state.initialLoadWatchdogId = null;
  }
}

async function probeMediaSources() {
  const videoProbe = await verifyMediaSource(MEDIA_CONFIG.videoSrc, "video");

  if (!videoProbe.ok) {
    if (videoProbe.hardFailure) {
      showFatalError(
        "Video source is not reachable. Check ./assets/character.mp4 path and codec (MP4 H.264/AAC).",
      );
      return;
    }

    console.warn("[media] video probe uncertain; continuing with runtime media events", videoProbe);
  }

  if (!state.useExternalAudio) {
    return;
  }

  const audioProbe = await verifyMediaSource(MEDIA_CONFIG.audioSrc, "audio");

  if (!audioProbe.ok && audioProbe.hardFailure) {
    disableExternalAudio(
      "External audio source is not reachable. Using video audio only.",
    );
    return;
  }

  if (!audioProbe.ok) {
    console.warn("[media] audio probe uncertain; will retry at playback time", audioProbe);
  }
}

async function verifyMediaSource(src, label) {
  const resolvedUrl = new URL(src, window.location.href);

  if (resolvedUrl.origin !== window.location.origin) {
    console.info(`[media] skipping reachability probe for cross-origin ${label}`, resolvedUrl.href);
    return {
      ok: true,
      hardFailure: false,
      status: null,
      reason: "cross-origin skip",
    };
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => {
    controller.abort();
  }, MEDIA_CONFIG.sourceProbeTimeoutMs);

  try {
    let response = await fetch(resolvedUrl, {
      method: "HEAD",
      cache: "no-store",
      signal: controller.signal,
    });

    if (response.status === 405 || response.status === 501) {
      response = await fetch(resolvedUrl, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      });
    }

    if (!response.ok) {
      const probeResult = {
        ok: false,
        hardFailure: response.status === 403 || response.status === 404 || response.status === 410,
        status: response.status,
        reason: `HTTP ${response.status}`,
      };

      console.error(`[media] ${label} source probe failed`, {
        src: resolvedUrl.href,
        ...probeResult,
      });
      return probeResult;
    }

    if (response.body && typeof response.body.cancel === "function") {
      void response.body.cancel();
    }

    console.info(`[media] ${label} source reachable`, {
      src: resolvedUrl.href,
      status: response.status,
    });
    return {
      ok: true,
      hardFailure: false,
      status: response.status,
      reason: "ok",
    };
  } catch (error) {
    const readableError =
      error instanceof Error ? `${error.name}: ${error.message}` : String(error);

    console.error(`[media] ${label} source probe failed`, {
      src: resolvedUrl.href,
      error: readableError,
    });
    return {
      ok: false,
      hardFailure: false,
      status: null,
      reason: readableError,
    };
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function disableExternalAudio(message, skipInlineMessage = false) {
  if (!state.useExternalAudio) {
    return;
  }

  state.useExternalAudio = false;
  applyAudioRouting();
  elements.audio.pause();
  stopSyncLoop();

  console.warn(`[media] ${message}`);

  if (!skipInlineMessage) {
    showNonFatalMediaMessage(message);
  }
}

function buildVideoErrorMessage() {
  const errorCode = elements.video.error?.code ?? "unknown";
  const reasonByCode = {
    1: "Playback was aborted.",
    2: "Network error while fetching video.",
    3: "Decode error (possible unsupported/corrupt codec).",
    4: "Video format is not supported by this browser.",
  };
  const reason = reasonByCode[errorCode] ?? "Unknown media error.";

  return `Video failed to load (${reason}) Check ./assets/character.mp4 and ensure MP4 H.264/AAC compatibility.`;
}

function formatMediaState(mediaElement) {
  return `readyState=${mediaElement.readyState}, networkState=${mediaElement.networkState}, currentSrc=${mediaElement.currentSrc || "none"}`;
}

function getMediaDebugSnapshot(mediaElement) {
  return {
    currentSrc: mediaElement.currentSrc,
    readyState: mediaElement.readyState,
    networkState: mediaElement.networkState,
    paused: mediaElement.paused,
    ended: mediaElement.ended,
    errorCode: mediaElement.error?.code ?? null,
    errorMessage: mediaElement.error?.message ?? null,
  };
}

function logCodecCompatibilityHints() {
  const mp4Support = elements.video.canPlayType(
    'video/mp4; codecs="avc1.42E01E, mp4a.40.2"',
  );
  const mp3Support = elements.audio.canPlayType("audio/mpeg");

  console.info("[media] codec support hint", {
    videoMp4H264Aac: mp4Support || "no",
    audioMp3: mp3Support || "no",
  });

  if (!mp4Support) {
    console.warn(
      "[media] Browser reported weak/no support for MP4 H.264/AAC. Mobile playback may fail.",
    );
  }
}
