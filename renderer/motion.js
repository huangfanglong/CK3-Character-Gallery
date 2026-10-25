/* Short, interruptible motion that keeps the underlying controls and focus stable. */
let activePortraitFlight = null;

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function portraitMotionContainer(element) {
  if (!element) return null;
  if (element.matches?.('.card-portrait, .inspector-portrait, .table-avatar')) return element;
  return element.querySelector?.('.card-portrait, .inspector-portrait, .table-avatar') || null;
}

function capturePortraitMotion(element) {
  if (prefersReducedMotion()) return null;
  const container = portraitMotionContainer(element);
  const media = container?.querySelector('.portrait-image, .portrait-placeholder');
  if (!container || !media) return null;
  const rect = container.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const clone = media.cloneNode(true);
  clone.removeAttribute('id');
  clone.removeAttribute('data-portrait-playback');
  return {
    clone,
    currentTime: media.tagName === 'VIDEO' ? media.currentTime : 0,
    rect,
    borderRadius: getComputedStyle(container).borderRadius,
    objectFit: getComputedStyle(media).objectFit,
    objectPosition: getComputedStyle(media).objectPosition,
  };
}

function cancelPortraitFlight() {
  if (!activePortraitFlight) return;
  const flight = activePortraitFlight;
  activePortraitFlight = null;
  for (const animation of flight.animations) animation.cancel();
  flight.cleanup();
}

function createPortraitFlight(snapshot) {
  cancelPortraitFlight();
  const wrapper = document.createElement('div');
  wrapper.className = 'portrait-flight';
  wrapper.setAttribute('aria-hidden', 'true');
  Object.assign(wrapper.style, {
    top: `${snapshot.rect.top}px`,
    left: `${snapshot.rect.left}px`,
    width: `${snapshot.rect.width}px`,
    height: `${snapshot.rect.height}px`,
    borderRadius: snapshot.borderRadius,
  });
  Object.assign(snapshot.clone.style, {
    width: '100%',
    height: '100%',
    objectFit: snapshot.objectFit,
    objectPosition: snapshot.objectPosition,
  });
  wrapper.appendChild(snapshot.clone);
  document.body.appendChild(wrapper);
  if (snapshot.clone.tagName === 'VIDEO') {
    snapshot.clone.muted = true;
    snapshot.clone.currentTime = snapshot.currentTime || 0;
    void snapshot.clone.play().catch(() => {});
  }
  const flight = {
    wrapper,
    animations: [],
    cleanup: () => {
      snapshot.clone.pause?.();
      wrapper.remove();
    },
  };
  activePortraitFlight = flight;
  return flight;
}

function finishPortraitFlight(flight) {
  flight.done = Promise.allSettled(flight.animations.map((animation) => animation.finished)).then(() => {
    if (activePortraitFlight !== flight) return;
    activePortraitFlight = null;
    flight.cleanup();
  });
  return flight.done;
}

function animateQuickLookOpen(snapshot, destination) {
  const container = portraitMotionContainer(destination);
  const media = container?.querySelector('.portrait-image, .portrait-placeholder');
  if (!snapshot || !container || !media) return Promise.resolve();
  const target = container.getBoundingClientRect();
  if (!target.width || !target.height) return Promise.resolve();
  container.closest('.quick-overlay')?.classList.add('shared-element-active');
  const flight = createPortraitFlight(snapshot);
  media.style.opacity = '0';
  const cleanup = flight.cleanup;
  flight.cleanup = () => {
    media.style.removeProperty('opacity');
    cleanup();
  };
  flight.animations.push(flight.wrapper.animate([
    {
      top: `${snapshot.rect.top}px`, left: `${snapshot.rect.left}px`,
      width: `${snapshot.rect.width}px`, height: `${snapshot.rect.height}px`,
      borderRadius: snapshot.borderRadius,
    },
    {
      top: `${target.top}px`, left: `${target.left}px`,
      width: `${target.width}px`, height: `${target.height}px`,
      borderRadius: getComputedStyle(container).borderRadius,
    },
  ], { duration: 420, easing: 'cubic-bezier(.2,.75,.2,1)', fill: 'forwards' }));
  return finishPortraitFlight(flight);
}

function animateQuickLookClose(snapshot, destination) {
  const container = portraitMotionContainer(destination);
  const media = container?.querySelector('.portrait-image, .portrait-placeholder');
  if (!snapshot || !container || !media) { cancelPortraitFlight(); return Promise.resolve(); }
  const target = container.getBoundingClientRect();
  if (!target.width || !target.height) { cancelPortraitFlight(); return Promise.resolve(); }
  const flight = createPortraitFlight(snapshot);
  media.style.opacity = '0';
  const cleanup = flight.cleanup;
  flight.cleanup = () => {
    media.style.removeProperty('opacity');
    cleanup();
  };
  flight.animations.push(flight.wrapper.animate([
    {
      top: `${snapshot.rect.top}px`, left: `${snapshot.rect.left}px`,
      width: `${snapshot.rect.width}px`, height: `${snapshot.rect.height}px`,
      opacity: 1,
    },
    {
      top: `${target.top}px`, left: `${target.left}px`,
      width: `${target.width}px`, height: `${target.height}px`,
      borderRadius: getComputedStyle(container).borderRadius,
      opacity: .96,
    },
  ], { duration: 340, easing: 'cubic-bezier(.3,.7,.2,1)', fill: 'forwards' }));
  return finishPortraitFlight(flight);
}

function animateQuickLookNavigation(snapshot, destination, direction) {
  const container = portraitMotionContainer(destination);
  const media = container?.querySelector('.portrait-image, .portrait-placeholder');
  if (!snapshot || !container || !media) { cancelPortraitFlight(); return Promise.resolve(); }
  const flight = createPortraitFlight(snapshot);
  const distance = Math.sign(direction) * 30;
  flight.wrapper.dataset.direction = String(Math.sign(direction));
  flight.animations.push(flight.wrapper.animate([
    { transform: 'translateX(0)', opacity: 1 },
    { transform: `translateX(${-distance}px)`, opacity: 0 },
  ], { duration: 220, easing: 'cubic-bezier(.3,.7,.2,1)', fill: 'forwards' }));
  flight.animations.push(media.animate([
    { transform: `translateX(${distance}px) scale(1.015)`, opacity: 0 },
    { transform: 'translateX(0) scale(1)', opacity: 1 },
  ], { duration: 300, easing: 'cubic-bezier(.2,.75,.2,1)', fill: 'both' }));
  return finishPortraitFlight(flight);
}

function captureCommandDockMotion() {
  if (prefersReducedMotion()) return null;
  return app.querySelector('.command-dock')?.getBoundingClientRect() || null;
}

function animateCommandDockMotion(previousRect) {
  const dock = app.querySelector('.command-dock');
  if (!previousRect || !dock) return;
  const nextRect = dock.getBoundingClientRect();
  if (Math.abs(previousRect.width - nextRect.width) < 1) return;
  dock.animate([
    { width: `${previousRect.width}px` },
    { width: `${nextRect.width}px` },
  ], { duration: 300, easing: 'cubic-bezier(.2,.8,.2,1)' });
}
