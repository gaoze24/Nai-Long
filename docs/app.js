const MEDIA_CONFIG = {
  videoSrc: "./assets/character.mp4",
  audioSrc: "./assets/character-audio.mp3",
  preferExternalAudio: true,
  syncThresholdSeconds: 0.18,
  syncIntervalMs: 260,
};

const state = {
  isPlaying: false,
  isLoading: true,
  hasFatalError: false,
  settingsOpen: false,
  useExternalAudio: MEDIA_CONFIG.preferExternalAudio,
  syncTimerId: null,
};

const elements = {
  video: document.getElementById("characterVideo"),
  audio: document.getElementById("characterAudio"),
  playButton: document.getElementById("playButton"),
  playButtonLabel: document.getElementById("playButtonLabel"),
  settingsButton: document.getElementById("settingsButton"),
  settingsModal: document.getElementById("settingsModal"),
  settingsPanel: document.querySelector("#settingsModal .modal-panel"),
  closeSettingsButton: document.getElementById("closeSettingsButton"),
  loadingOverlay: document.getElementById("loadingOverlay"),
  loadingText: document.getElementById("loadingText"),
  errorMessage: document.getElementById("errorMessage"),
  statusMessage: document.getElementById("statusMessage"),
  externalAudioToggle: document.getElementById("externalAudioToggle"),
  rateSelect: document.getElementById("rateSelect"),
  volumeSlider: document.getElementById("volumeSlider"),
};

initializeApp();

function initializeApp() {
  elements.video.src = MEDIA_CONFIG.videoSrc;
  elements.audio.src = MEDIA_CONFIG.audioSrc;

  elements.video.load();
  elements.audio.load();

  elements.externalAudioToggle.checked = state.useExternalAudio;
  applyAudioRouting();

  wireMediaEvents();
  wireUiEvents();
  render();
}

function wireMediaEvents() {
  elements.video.addEventListener("canplay", () => {
    setLoading(false);
    setStatus("Ready to play");
  });

  elements.video.addEventListener("waiting", () => {
    if (state.isPlaying) {
      setLoading(true, "Buffering media...");
    }
  });

  elements.video.addEventListener("playing", () => {
    setLoading(false);
  });

  elements.video.addEventListener("pause", () => {
    if (!elements.video.ended && !state.hasFatalError) {
      state.isPlaying = false;
      stopSyncLoop();
      renderPlayButton();
      setStatus("Paused");
    }
  });

  elements.video.addEventListener("ended", () => {
    pauseEverything();
    elements.video.currentTime = 0;
    if (state.useExternalAudio) {
      elements.audio.currentTime = 0;
    }
    setStatus("Playback finished");
  });

  elements.video.addEventListener("seeking", () => {
    syncAudioToVideo("seek");
  });

  elements.video.addEventListener("ratechange", () => {
    const rate = elements.video.playbackRate;
    elements.rateSelect.value = String(rate);
    if (state.useExternalAudio) {
      elements.audio.playbackRate = rate;
    }
  });

  elements.video.addEventListener("error", () => {
    showFatalError("Video failed to load. Replace ./assets/character.mp4 and reload.");
  });

  elements.audio.addEventListener("error", () => {
    if (state.useExternalAudio) {
      state.useExternalAudio = false;
      elements.externalAudioToggle.checked = false;
      applyAudioRouting();
      setStatus("External audio unavailable. Using video audio only.");
    }
  });
}

function wireUiEvents() {
  elements.playButton.addEventListener("click", handlePlayToggle);

  elements.settingsButton.addEventListener("click", toggleSettingsModal);

  elements.closeSettingsButton.addEventListener("click", closeSettingsModal);

  // Close when clicking/tapping outside both the panel and its side toggle button.
  document.addEventListener("pointerdown", (event) => {
    if (!state.settingsOpen) {
      return;
    }

    if (!(event.target instanceof Node)) {
      return;
    }

    const clickedPanel = elements.settingsPanel.contains(event.target);
    const clickedSettingsButton = elements.settingsButton.contains(event.target);

    if (!clickedPanel && !clickedSettingsButton) {
      closeSettingsModal({ focusButton: false });
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.settingsOpen) {
      closeSettingsModal();
    }
  });

  elements.externalAudioToggle.addEventListener("change", () => {
    state.useExternalAudio = elements.externalAudioToggle.checked;
    applyAudioRouting();

    if (!state.useExternalAudio) {
      elements.audio.pause();
      stopSyncLoop();
      setStatus("Using video audio");
      return;
    }

    if (state.isPlaying) {
      void startExternalAudioDuringPlayback();
    } else {
      setStatus("Separate audio enabled");
    }
  });

  elements.rateSelect.addEventListener("change", () => {
    const nextRate = Number(elements.rateSelect.value);
    elements.video.playbackRate = nextRate;
    if (state.useExternalAudio) {
      elements.audio.playbackRate = nextRate;
    }
    setStatus(`Playback speed ${nextRate}x`);
  });

  elements.volumeSlider.addEventListener("input", () => {
    const nextVolume = Number(elements.volumeSlider.value);
    elements.video.volume = nextVolume;
    elements.audio.volume = nextVolume;
  });
}

async function handlePlayToggle() {
  if (state.hasFatalError) {
    return;
  }

  if (state.isPlaying) {
    pauseEverything();
    setStatus("Paused");
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
    await waitForCanPlay(elements.video, 9000);
    applyAudioRouting();

    elements.video.playbackRate = Number(elements.rateSelect.value);
    elements.audio.playbackRate = elements.video.playbackRate;

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
    setStatus("Playing");
  } catch (error) {
    await handlePlaybackStartError(error);
  }
}

async function startExternalAudioDuringPlayback() {
  try {
    await waitForCanPlay(elements.audio, 6000);
    await alignAudioWithVideo();
    await elements.audio.play();
    startSyncLoop();
    setStatus("Separate audio synced");
  } catch (error) {
    state.useExternalAudio = false;
    elements.externalAudioToggle.checked = false;
    applyAudioRouting();
    setStatus("Could not start separate audio. Using video audio only.");
    console.warn("External audio failed:", error);
  }
}

async function handlePlaybackStartError(error) {
  console.warn("Playback start failed:", error);

  if (state.useExternalAudio) {
    state.useExternalAudio = false;
    elements.externalAudioToggle.checked = false;
    applyAudioRouting();

    try {
      await elements.video.play();
      state.isPlaying = true;
      setLoading(false);
      renderPlayButton();
      setStatus("Playing with video audio only");
      return;
    } catch (videoOnlyError) {
      console.warn("Video-only fallback failed:", videoOnlyError);
    }
  }

  state.isPlaying = false;
  setLoading(false);
  setStatus("Playback blocked. Tap Play again or check browser settings.");
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

  await waitForCanPlay(elements.audio, 6000);
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

    syncAudioToVideo("interval");
  }, MEDIA_CONFIG.syncIntervalMs);
}

function stopSyncLoop() {
  if (state.syncTimerId) {
    window.clearInterval(state.syncTimerId);
    state.syncTimerId = null;
  }
}

function syncAudioToVideo(reason) {
  if (!state.useExternalAudio || !Number.isFinite(elements.audio.duration)) {
    return;
  }

  const drift = elements.video.currentTime - elements.audio.currentTime;
  const driftAbs = Math.abs(drift);

  if (driftAbs < MEDIA_CONFIG.syncThresholdSeconds) {
    return;
  }

  elements.audio.currentTime = safeCurrentTime(elements.video.currentTime, elements.audio.duration);

  if (reason === "seek") {
    setStatus("Synced after seek");
  }
}

function waitForCanPlay(mediaElement, timeoutMs) {
  if (mediaElement.readyState >= 2) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for media readiness"));
    }, timeoutMs);

    const onCanPlay = () => {
      cleanup();
      resolve();
    };

    const onError = () => {
      cleanup();
      reject(new Error("Media failed while waiting for readiness"));
    };

    function cleanup() {
      window.clearTimeout(timeoutId);
      mediaElement.removeEventListener("canplay", onCanPlay);
      mediaElement.removeEventListener("error", onError);
    }

    mediaElement.addEventListener("canplay", onCanPlay, { once: true });
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
  stopSyncLoop();
  elements.errorMessage.textContent = message;
  elements.errorMessage.hidden = false;
  elements.playButton.disabled = true;
  setLoading(false);
  setStatus(message);
  renderPlayButton();
}

function clearNonFatalError() {
  if (!state.hasFatalError) {
    elements.errorMessage.hidden = true;
  }
}

function setLoading(isLoading, text = "Loading media...") {
  state.isLoading = isLoading;
  elements.loadingText.textContent = text;
  elements.loadingOverlay.classList.toggle("is-hidden", !isLoading);
}

function setStatus(message) {
  elements.statusMessage.textContent = message;
}

function renderPlayButton() {
  elements.playButton.classList.toggle("is-playing", state.isPlaying);
  elements.playButton.setAttribute("aria-pressed", String(state.isPlaying));
  elements.playButton.setAttribute(
    "aria-label",
    state.isPlaying ? "Pause media" : "Play media",
  );
  elements.playButtonLabel.textContent = state.isPlaying ? "Pause" : "Play";
}

function renderModal() {
  elements.settingsModal.classList.toggle("is-open", state.settingsOpen);
  elements.settingsModal.setAttribute("aria-hidden", String(!state.settingsOpen));
  elements.settingsButton.setAttribute("aria-expanded", String(state.settingsOpen));
}

function render() {
  renderPlayButton();
  renderModal();
  setLoading(state.isLoading);
}

function openSettingsModal() {
  state.settingsOpen = true;
  renderModal();
  elements.closeSettingsButton.focus();
}

function closeSettingsModal(options = {}) {
  const { focusButton = true } = options;

  if (!state.settingsOpen) {
    return;
  }

  state.settingsOpen = false;
  renderModal();

  if (focusButton) {
    elements.settingsButton.focus();
  }
}

function toggleSettingsModal() {
  if (state.settingsOpen) {
    closeSettingsModal({ focusButton: false });
    return;
  }

  openSettingsModal();
}
