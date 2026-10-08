(() => {
  const audio = document.getElementById("audio");
  const playToggle = document.getElementById("playToggle");
  const miniToggle = document.getElementById("miniToggle");
  const miniPlayer = document.getElementById("miniPlayer");
  const miniTime = document.getElementById("miniTime");
  const mainPlayer = document.getElementById("mainPlayer");
  const letraSection = document.querySelector(".letra");
  const lyricsEl = document.getElementById("lyrics");
  const seek = document.getElementById("seek");
  const miniSeek = document.getElementById("miniSeek");
  const timeCurrent = document.getElementById("timeCurrent");
  const timeTotal = document.getElementById("timeTotal");
  const playerSub = document.getElementById("playerSub");
  const lyricLive = document.getElementById("lyricLive");
  const shareBtn = document.getElementById("shareBtn");

  const SITE_URL = "https://lucasfrotam.github.io/homenagem-antonio-marinho-80-anos/";
  const COVER_URL = new URL("assets/capa.jpg", window.location.href).href;
  const COVER_512 = new URL("assets/capa-512.jpg", window.location.href).href;
  const LYRICS_URL = new URL("assets/lyrics.json?v=3", window.location.href).href;
  const prefersReducedMotion = () =>
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let lines = [];
  let copyTimer = null;
  let seeking = false;
  let activeIndex = -1;
  let userScrollUntil = 0;
  let lastAutoScroll = 0;
  let followEnabled = true;
  let ready = false;
  let scrollAnim = null;
  let scrollTargetEl = null;
  let scrollLockedUntil = 0;
  // Evita flash da linha anterior ao clicar/seek (timeupdate atrasado)
  let lyricJumpLock = null;
  let wakeLock = null;

  const format = (sec) => {
    if (!Number.isFinite(sec)) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  const durationReady = () =>
    Number.isFinite(audio.duration) && audio.duration > 0;

  const setReady = (isReady) => {
    ready = isReady;
    mainPlayer.classList.toggle("is-loading", !isReady);
    playToggle.disabled = !isReady;
    seek.disabled = !isReady;
    miniSeek.disabled = !isReady;
    if (isReady) {
      playerSub.textContent = "Escute e acompanhe a letra";
    }
  };

  const setProgress = (pct) => {
    const clamped = Math.max(0, Math.min(100, pct));
    const value = String(clamped);
    seek.value = value;
    miniSeek.value = value;
    seek.style.setProperty("--progress", `${clamped}%`);
    miniSeek.style.setProperty("--progress", `${clamped}%`);
  };

  const setPlayingUI = (playing) => {
    document.body.classList.toggle("is-playing", playing);
    letraSection?.classList.toggle("is-following", playing && followEnabled);
    const label = playing ? "Pausar a canção" : "Tocar a canção";
    playToggle.setAttribute("aria-label", label);
    miniToggle.setAttribute("aria-label", label);
  };

  const lineStart = (el) => Number(el.dataset.start) || 0;

  const findActiveIndex = (t) => {
    if (!lines.length) return -1;
    let idx = 0;
    for (let i = 0; i < lines.length; i++) {
      if (t >= lineStart(lines[i])) idx = i;
      else break;
    }
    return idx;
  };

  const easeInOutCubic = (t) =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  const scrollToLine = (el, duration = 520) => {
    if (!el) return;
    const now = Date.now();
    if (scrollAnim || now < scrollLockedUntil) {
      if (scrollTargetEl === el) return;
      if (scrollAnim && scrollTargetEl !== el) {
        cancelAnimationFrame(scrollAnim);
        scrollAnim = null;
      } else if (now < scrollLockedUntil && scrollTargetEl === el) {
        return;
      }
    }

    scrollTargetEl = el;

    const prefersReduced = prefersReducedMotion();

    const rect = el.getBoundingClientRect();
    const maxScroll = Math.max(
      0,
      document.documentElement.scrollHeight - window.innerHeight
    );
    // Mantém a linha ativa ~38% do viewport; no fim da página evita “vazio” embaixo
    const idx = Number(el.dataset.index);
    const nearEnd = Number.isFinite(idx) && idx >= lines.length - 3;
    const anchor = nearEnd ? 0.62 : 0.38;
    const target = Math.min(
      maxScroll,
      Math.max(0, window.scrollY + rect.top - window.innerHeight * anchor)
    );
    const start = window.scrollY;
    const distance = target - start;

    if (Math.abs(distance) < 18) {
      lastAutoScroll = Date.now();
      scrollLockedUntil = lastAutoScroll + 280;
      scrollTargetEl = null;
      return;
    }

    if (prefersReduced || duration <= 0) {
      window.scrollTo(0, target);
      lastAutoScroll = Date.now();
      scrollLockedUntil = lastAutoScroll + 280;
      scrollTargetEl = null;
      return;
    }

    const startTime = performance.now();
    lastAutoScroll = Date.now();
    scrollLockedUntil = lastAutoScroll + duration + 160;

    const step = (frame) => {
      const elapsed = frame - startTime;
      const progress = Math.min(1, elapsed / duration);
      window.scrollTo(0, start + distance * easeInOutCubic(progress));
      lastAutoScroll = Date.now();
      if (progress < 1) {
        scrollAnim = requestAnimationFrame(step);
      } else {
        scrollAnim = null;
        scrollTargetEl = null;
        scrollLockedUntil = Date.now() + 220;
      }
    };

    scrollAnim = requestAnimationFrame(step);
  };

  const syncLyrics = (t, opts = {}) => {
    const { forceScroll = false, fromPlay = false, forceIndex = null } = opts;
    if (!lines.length) return;

    let idx =
      forceIndex != null && forceIndex >= 0 && forceIndex < lines.length
        ? forceIndex
        : findActiveIndex(t);

    if (forceIndex == null && lyricJumpLock) {
      const { index, target, until } = lyricJumpLock;
      const settled = Math.abs(t - target) < 0.55;
      if (!settled && Date.now() < until) {
        idx = index;
      } else {
        lyricJumpLock = null;
        idx = findActiveIndex(t);
      }
    }

    const changed = idx !== activeIndex;

    if (changed) {
      activeIndex = idx;
      for (let i = 0; i < lines.length; i++) {
        const near =
          idx >= 0 && Math.abs(i - idx) === 1 && !prefersReducedMotion();
        lines[i].classList.toggle("is-passed", idx >= 0 && i < idx);
        lines[i].classList.toggle("is-active", i === idx);
        lines[i].classList.toggle("is-near", near);
      }
      if (idx >= 0) {
        const current = lines[idx];
        if (lyricLive) {
          lyricLive.textContent = current.classList.contains("is-beat")
            ? "Trecho instrumental"
            : current.textContent.trim();
        }
      } else if (lyricLive) {
        lyricLive.textContent = "";
      }
    }

    if (idx < 0) return;
    const current = lines[idx];
    const autoFollowOk =
      followEnabled && !audio.paused && Date.now() > userScrollUntil;
    const reduced = prefersReducedMotion();

    if (forceScroll || fromPlay) {
      scrollToLine(current, reduced ? 0 : forceScroll || fromPlay ? 480 : 520);
      return;
    }

    if (!changed || !autoFollowOk) return;

    if (reduced) {
      // Sem animação: só reposiciona se a linha ativa sair da zona confortável
      const rect = current.getBoundingClientRect();
      const out =
        rect.top < window.innerHeight * 0.18 ||
        rect.bottom > window.innerHeight * 0.82;
      if (out) scrollToLine(current, 0);
      return;
    }

    scrollToLine(current, 520);
  };

  const applySeekFromPct = (pct, { preview = false } = {}) => {
    if (!durationReady()) return false;
    const next = (Math.max(0, Math.min(100, pct)) / 100) * audio.duration;
    try {
      if (typeof audio.fastSeek === "function") audio.fastSeek(next);
      else audio.currentTime = next;
    } catch (_) {
      audio.currentTime = next;
    }
    timeCurrent.textContent = format(next);
    if (preview || seeking) {
      miniTime.textContent = format(next);
      miniPlayer.classList.add("is-seeking");
    } else {
      miniTime.textContent = `${format(next)} / ${format(audio.duration)}`;
      miniPlayer.classList.remove("is-seeking");
    }
    syncLyrics(next, { forceScroll: true });
    return true;
  };

  const endSeek = () => {
    if (!seeking) return;
    seeking = false;
    applySeekFromPct(Number(seek.value) || Number(miniSeek.value), {
      preview: false,
    });
  };

  const bindSeekControl = (el) => {
    el.addEventListener("pointerdown", (e) => {
      if (!ready) return;
      seeking = true;
      miniPlayer.classList.add("is-seeking");
      if (typeof el.setPointerCapture === "function") {
        try {
          el.setPointerCapture(e.pointerId);
        } catch (_) {
          /* ignore */
        }
      }
    });

    el.addEventListener("input", () => {
      if (!ready) return;
      seeking = true;
      const pct = Number(el.value);
      setProgress(pct);
      applySeekFromPct(pct, { preview: true });
    });

    el.addEventListener("change", endSeek);
    el.addEventListener("pointerup", endSeek);
    el.addEventListener("pointercancel", endSeek);
    el.addEventListener("touchend", endSeek, { passive: true });
  };

  bindSeekControl(seek);
  bindSeekControl(miniSeek);
  window.addEventListener("pointerup", endSeek);
  window.addEventListener("mouseup", endSeek);

  const IDLE_RETURN_MS = 3000;
  let idleReturnTimer = null;

  const clearIdleReturn = () => {
    if (idleReturnTimer) {
      window.clearTimeout(idleReturnTimer);
      idleReturnTimer = null;
    }
  };

  const resumeFollow = () => {
    followEnabled = true;
    userScrollUntil = 0;
    clearIdleReturn();
    letraSection?.classList.toggle("is-following", !audio.paused);
  };

  const scheduleReturnToLyric = () => {
    clearIdleReturn();
    if (audio.paused) return;
    idleReturnTimer = window.setTimeout(() => {
      idleReturnTimer = null;
      if (audio.paused) return;
      resumeFollow();
      syncLyrics(audio.currentTime, { forceScroll: true });
    }, IDLE_RETURN_MS);
  };

  const requestWakeLock = async () => {
    if (!("wakeLock" in navigator)) return;
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => {
        wakeLock = null;
      });
    } catch (_) {
      wakeLock = null;
    }
  };

  const releaseWakeLock = async () => {
    try {
      await wakeLock?.release();
    } catch (_) {
      /* ignore */
    }
    wakeLock = null;
  };

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !audio.paused) {
      requestWakeLock();
    }
  });

  const toggle = async () => {
    if (!ready) return;
    try {
      if (audio.paused) {
        resumeFollow();
        await audio.play();
      } else {
        audio.pause();
      }
    } catch (err) {
      console.warn("Não foi possível iniciar o áudio:", err);
      playerSub.textContent = "Toque de novo para tocar a canção";
    }
  };

  playToggle.addEventListener("click", toggle);
  miniToggle.addEventListener("click", toggle);

  window.addEventListener("keydown", (e) => {
    if (e.code !== "Space" && e.key !== " ") return;
    const el = e.target;
    const tag = (el && el.tagName) || "";
    if (/INPUT|TEXTAREA|BUTTON|SELECT|A/.test(tag)) return;
    if (el && (el.isContentEditable || el.closest?.(".lyric-line"))) return;
    e.preventDefault();
    toggle();
  });

  const enterLyricsExperience = () => {
    resumeFollow();
    setPlayingUI(true);
    requestWakeLock();
    // No começo (intro de batida), garante foco na primeira linha/divisor
    const t = audio.currentTime || 0;
    if (t < 1.2 && lines[0]?.classList.contains("is-beat")) {
      try {
        audio.currentTime = 0;
      } catch (_) {
        /* ignore */
      }
    }
    requestAnimationFrame(() => {
      syncLyrics(audio.currentTime || 0, {
        forceScroll: true,
        fromPlay: true,
      });
    });
  };

  audio.addEventListener("play", enterLyricsExperience);
  audio.addEventListener("pause", () => {
    setPlayingUI(false);
    releaseWakeLock();
  });
  audio.addEventListener("ended", () => {
    setPlayingUI(false);
    releaseWakeLock();
    audio.currentTime = 0;
    setProgress(0);
    syncLyrics(0, { forceScroll: false });
  });

  audio.addEventListener("loadedmetadata", () => {
    timeTotal.textContent = format(audio.duration);
    miniTime.textContent = `${format(audio.currentTime)} / ${format(audio.duration)}`;
    setReady(true);
  });

  audio.addEventListener("canplay", () => {
    if (!ready) setReady(true);
  });

  audio.addEventListener("waiting", () => {
    if (!audio.paused) playerSub.textContent = "Carregando…";
  });

  audio.addEventListener("playing", () => {
    playerSub.textContent = "Escute e acompanhe a letra";
  });

  audio.addEventListener("error", () => {
    playerSub.textContent = "Não foi possível carregar a canção";
    mainPlayer.classList.remove("is-loading");
  });

  if (durationReady()) setReady(true);

  let scrollTick = null;
  window.addEventListener(
    "scroll",
    () => {
      if (scrollTick) return;
      scrollTick = requestAnimationFrame(() => {
        scrollTick = null;
        if (scrollAnim || Date.now() < scrollLockedUntil) return;
        if (Date.now() - lastAutoScroll < 1000) return;
        if (audio.paused) return;
        followEnabled = false;
        userScrollUntil = Date.now() + IDLE_RETURN_MS;
        letraSection?.classList.remove("is-following");
        scheduleReturnToLyric();
      });
    },
    { passive: true }
  );

  audio.addEventListener("pause", () => {
    clearIdleReturn();
  });

  audio.addEventListener("timeupdate", () => {
    if (seeking || !durationReady()) return;
    const pct = (audio.currentTime / audio.duration) * 100;
    setProgress(pct);
    timeCurrent.textContent = format(audio.currentTime);
    miniTime.textContent = `${format(audio.currentTime)} / ${format(audio.duration)}`;
    syncLyrics(audio.currentTime);
  });

  const bindLine = (el) => {
    el.setAttribute("tabindex", "0");
    el.setAttribute("role", "button");
    const label = el.classList.contains("is-beat")
      ? "Trecho instrumental"
      : `Tocar: ${el.textContent.trim()}`;
    el.setAttribute("aria-label", label);

    const jump = async () => {
      if (!ready && !durationReady()) {
        playerSub.textContent = "Aguarde carregar a canção…";
        return;
      }
      const index = Number(el.dataset.index);
      const start = Math.max(0, lineStart(el));
      resumeFollow();

      const go = async () => {
        lyricJumpLock = {
          index,
          target: start,
          until: Date.now() + 600,
        };
        try {
          if (typeof audio.fastSeek === "function") audio.fastSeek(start);
          else audio.currentTime = start;
        } catch (_) {
          audio.currentTime = start;
        }
        setProgress((start / audio.duration) * 100);
        syncLyrics(start, { forceScroll: true, forceIndex: index });
        // Tira o foco/hover residual do toque (relevo que ficava na linha)
        el.blur();
        try {
          if (audio.paused) await audio.play();
        } catch (_) {
          /* ignore */
        }
      };

      if (!durationReady()) {
        audio.addEventListener("loadedmetadata", go, { once: true });
        return;
      }
      await go();
    };

    el.addEventListener("click", jump);
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        jump();
      }
    });
  };

  const renderLyrics = (data) => {
    if (!lyricsEl) return;
    lyricsEl.innerHTML = "";
    lyricsEl.setAttribute("aria-busy", "false");
    lines = [];

    let prevKind = null;
    let chorusBlock = null;

    data.forEach((item, index) => {
      const kind = item.kind || "line";
      const t = Number(item.t) || 0;
      const newChorus = kind === "chorus" && prevKind !== "chorus";
      const leavingChorus = kind !== "chorus" && prevKind === "chorus";

      if (leavingChorus) chorusBlock = null;

      if (newChorus) {
        chorusBlock = document.createElement("div");
        chorusBlock.className = "chorus-block";
        const label = document.createElement("span");
        label.className = "refrao-label";
        label.textContent = "Refrão";
        chorusBlock.appendChild(label);
        lyricsEl.appendChild(chorusBlock);
      }

      const el = document.createElement("p");
      el.className = "lyric-line";
      if (kind === "chorus") el.classList.add("is-chorus");
      if (kind === "beat") {
        el.classList.add("is-beat");
        el.innerHTML =
          '<span class="ornament lyric-ornament" aria-hidden="true"><span></span><i>♥</i><span></span></span>';
      } else {
        el.textContent = item.text;
      }
      el.dataset.start = String(t);
      el.dataset.index = String(index);
      bindLine(el);
      (chorusBlock || lyricsEl).appendChild(el);
      lines.push(el);
      prevKind = kind;
    });
  };

  const loadLyrics = async () => {
    try {
      const res = await fetch(LYRICS_URL, { cache: "no-cache" });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      if (!Array.isArray(data) || !data.length) throw new Error("empty");
      renderLyrics(data);
      syncLyrics(audio.currentTime || 0, { forceScroll: false });
    } catch (err) {
      console.warn("Não foi possível carregar a letra:", err);
      if (lyricsEl) {
        lyricsEl.setAttribute("aria-busy", "false");
        lyricsEl.textContent = "Não foi possível carregar a letra.";
      }
    }
  };

  loadLyrics();

  let miniTimer = null;
  let miniVisible = false;
  let pendingMini = false;

  const applyMiniVisibility = () => {
    miniTimer = null;
    if (pendingMini === miniVisible) return;
    if (scrollAnim || Date.now() < scrollLockedUntil) {
      miniTimer = window.setTimeout(applyMiniVisibility, 140);
      return;
    }
    miniVisible = pendingMini;
    miniPlayer.classList.toggle("is-visible", miniVisible);
    miniPlayer.setAttribute("aria-hidden", miniVisible ? "false" : "true");
  };

  const io = new IntersectionObserver(
    ([entry]) => {
      pendingMini = !entry.isIntersecting;
      if (miniTimer) window.clearTimeout(miniTimer);
      miniTimer = window.setTimeout(applyMiniVisibility, 150);
    },
    { threshold: 0.25, rootMargin: "-16px 0px 0px 0px" }
  );
  io.observe(mainPlayer);

  const reveals = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    const revealIo = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            revealIo.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    reveals.forEach((el) => revealIo.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add("is-in"));
  }

  const setupMediaSession = () => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: "Homenagem — 80 anos",
      artist: "Antônio Marinho",
      album: "Nossa família, nossa união",
      artwork: [
        { src: COVER_URL, sizes: "1200x1200", type: "image/jpeg" },
        { src: COVER_512, sizes: "512x512", type: "image/jpeg" },
        {
          src: new URL("assets/apple-touch-icon.png", window.location.href).href,
          sizes: "180x180",
          type: "image/png",
        },
      ],
    });
    navigator.mediaSession.setActionHandler("play", () => audio.play());
    navigator.mediaSession.setActionHandler("pause", () => audio.pause());
    navigator.mediaSession.setActionHandler("seekto", (details) => {
      if (details.seekTime != null) {
        audio.currentTime = details.seekTime;
        syncLyrics(details.seekTime, { forceScroll: true });
      }
    });
  };
  setupMediaSession();

  const showCopied = () => {
    if (!shareBtn) return;
    shareBtn.classList.add("is-copied");
    shareBtn.setAttribute("aria-label", "Link copiado");
    if (copyTimer) window.clearTimeout(copyTimer);
    // Tempo maior pra a troca de volta também respirar (saída → entrada em sequência)
    copyTimer = window.setTimeout(() => {
      shareBtn.classList.remove("is-copied");
      shareBtn.setAttribute("aria-label", "Copiar link");
    }, 2800);
  };

  shareBtn?.addEventListener("click", async () => {
    const link = window.location.href.startsWith("http")
      ? window.location.href.split("#")[0]
      : SITE_URL;
    try {
      await navigator.clipboard.writeText(link);
      showCopied();
    } catch (_) {
      const input = document.createElement("input");
      input.value = link;
      input.setAttribute("readonly", "");
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      try {
        document.execCommand("copy");
        showCopied();
      } catch (err) {
        window.prompt("Copie o link:", link);
      }
      document.body.removeChild(input);
    }
  });

  const og = document.querySelector('meta[property="og:image"]');
  if (og && !/^https?:/i.test(og.content)) {
    og.setAttribute("content", new URL(og.content, SITE_URL).href);
  }

  const ogUrl = document.querySelector('meta[property="og:url"]');
  if (ogUrl && !/^https?:/i.test(ogUrl.content)) {
    ogUrl.setAttribute("content", SITE_URL);
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {
        /* offline / file:// */
      });
    });
  }

  // Prefetch agressivo do áudio (além de preload="auto")
  try {
    audio.load();
  } catch (_) {
    /* ignore */
  }

  setProgress(0);
})();
