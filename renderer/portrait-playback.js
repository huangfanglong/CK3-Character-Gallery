const portraitVideos = new Set();
const portraitVisibility = new WeakMap();
const activePortraitVideos = new WeakSet();
const primedPortraitSources = new WeakMap();
let portraitPlaybackBlocked = false;

function playPortraitVideo(video) {
  if (!video.paused) return;
  void video.play().catch(() => {});
}

function applyPortraitPlayback(video) {
  const blocked = portraitPlaybackBlocked || document.hidden || !video.isConnected;
  const active = video.dataset.portraitPlayback === 'viewport'
    ? portraitVisibility.get(video) === true
    : activePortraitVideos.has(video);
  if (!blocked && active) playPortraitVideo(video);
  else video.pause();
}

const portraitObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    portraitVisibility.set(entry.target, entry.isIntersecting && entry.intersectionRatio > 0);
    applyPortraitPlayback(entry.target);
  }
}, { threshold: 0.01 });

function primePortraitVideo(video) {
  const source = video.getAttribute('src') || '';
  if (!source || primedPortraitSources.get(video) === source) return;
  primedPortraitSources.set(video, source);
  const finish = () => {
    if (video.getAttribute('src') === source) applyPortraitPlayback(video);
  };
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) { finish(); return; }
  video.addEventListener('loadeddata', finish, { once: true });
  const playing = video.play();
  if (typeof video.requestVideoFrameCallback === 'function') {
    void playing.then(() => video.requestVideoFrameCallback(finish)).catch(() => {});
  } else void playing.catch(() => {});
}

function syncPortraitPlayback(root = document, blocked = false) {
  portraitPlaybackBlocked = Boolean(blocked);
  const current = new Set(root.querySelectorAll('.portrait-video'));
  for (const video of portraitVideos) {
    if (current.has(video) && video.isConnected) continue;
    portraitObserver.unobserve(video);
    portraitVideos.delete(video);
  }
  for (const video of current) {
    portraitVideos.add(video);
    if (video.dataset.portraitPlayback === 'viewport') portraitObserver.observe(video);
    else {
      portraitObserver.unobserve(video);
      const thumb = video.closest('.variant-thumb');
      const active = thumb
        ? thumb.matches(':hover') || thumb.contains(document.activeElement)
        : video.closest('.table-portrait-preview')?.classList.contains('visible');
      if (active) activePortraitVideos.add(video);
      else activePortraitVideos.delete(video);
      primePortraitVideo(video);
    }
    applyPortraitPlayback(video);
  }
}

function setPortraitPlaybackActive(container, active) {
  const videos = container?.matches?.('.portrait-video') ? [container] : [...(container?.querySelectorAll?.('.portrait-video') || [])];
  for (const video of videos) {
    if (video.dataset.portraitPlayback !== 'interaction') continue;
    if (active) activePortraitVideos.add(video);
    else activePortraitVideos.delete(video);
    applyPortraitPlayback(video);
  }
}

document.addEventListener('visibilitychange', () => {
  for (const video of portraitVideos) applyPortraitPlayback(video);
});
