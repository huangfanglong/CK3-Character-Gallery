(function captureGeometryModule(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined') module.exports = api;
  Object.assign(root, api);
}(typeof globalThis === 'undefined' ? this : globalThis, () => {
  function displayRectForVideo(containerWidth, containerHeight, videoWidth, videoHeight) {
    if (!(containerWidth > 0 && containerHeight > 0 && videoWidth > 0 && videoHeight > 0)) return { x: 0, y: 0, width: 0, height: 0 };
    const scale = Math.min(containerWidth / videoWidth, containerHeight / videoHeight);
    const width = videoWidth * scale;
    const height = videoHeight * scale;
    return { x: (containerWidth - width) / 2, y: (containerHeight - height) / 2, width, height };
  }

  function defaultCaptureCrop(videoWidth, videoHeight) {
    const size = Math.min(videoWidth, videoHeight);
    return { x: Math.floor((videoWidth - size) / 2), y: Math.floor((videoHeight - size) / 2), size };
  }

  function clampCaptureCrop(crop, videoWidth, videoHeight) {
    const size = Math.max(1, Math.min(Math.round(crop.size), videoWidth, videoHeight));
    return {
      x: Math.max(0, Math.min(Math.round(crop.x), videoWidth - size)),
      y: Math.max(0, Math.min(Math.round(crop.y), videoHeight - size)),
      size,
    };
  }

  function moveCaptureCrop(crop, deltaX, deltaY, videoWidth, videoHeight) {
    return clampCaptureCrop({
      x: crop.x + deltaX,
      y: crop.y + deltaY,
      size: crop.size,
    }, videoWidth, videoHeight);
  }

  function centeredCaptureCrop(crop, videoWidth, videoHeight) {
    return clampCaptureCrop({
      x: (videoWidth - crop.size) / 2,
      y: (videoHeight - crop.size) / 2,
      size: crop.size,
    }, videoWidth, videoHeight);
  }

  function resizeCaptureCrop(crop, handle, point, videoWidth, videoHeight, minimumSize = 1) {
    const handles = {
      'north-west': { anchorX: crop.x + crop.size, anchorY: crop.y + crop.size, directionX: -1, directionY: -1 },
      'north-east': { anchorX: crop.x, anchorY: crop.y + crop.size, directionX: 1, directionY: -1 },
      'south-east': { anchorX: crop.x, anchorY: crop.y, directionX: 1, directionY: 1 },
      'south-west': { anchorX: crop.x + crop.size, anchorY: crop.y, directionX: -1, directionY: 1 },
    };
    const geometry = handles[handle];
    if (!geometry || !Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return clampCaptureCrop(crop, videoWidth, videoHeight);
    const xDistance = geometry.directionX * (point.x - geometry.anchorX);
    const yDistance = geometry.directionY * (point.y - geometry.anchorY);
    const maximumSize = Math.min(
      geometry.directionX < 0 ? geometry.anchorX : videoWidth - geometry.anchorX,
      geometry.directionY < 0 ? geometry.anchorY : videoHeight - geometry.anchorY,
    );
    const size = Math.max(1, Math.min(maximumSize, Math.max(Math.round(minimumSize), Math.round(xDistance), Math.round(yDistance))));
    return clampCaptureCrop({
      x: geometry.directionX < 0 ? geometry.anchorX - size : geometry.anchorX,
      y: geometry.directionY < 0 ? geometry.anchorY - size : geometry.anchorY,
      size,
    }, videoWidth, videoHeight);
  }

  function resizeCaptureCropFromCenter(crop, deltaSize, videoWidth, videoHeight, minimumSize = 1) {
    const centerX = crop.x + crop.size / 2;
    const centerY = crop.y + crop.size / 2;
    const size = Math.max(minimumSize, Math.min(crop.size + deltaSize, videoWidth, videoHeight));
    return clampCaptureCrop({ x: centerX - size / 2, y: centerY - size / 2, size }, videoWidth, videoHeight);
  }

  function nearestSnap(value, candidates, threshold) {
    let nearest = value;
    let nearestDistance = threshold + Number.EPSILON;
    candidates.forEach((candidate) => {
      const distance = Math.abs(candidate - value);
      if (distance <= threshold && distance < nearestDistance) {
        nearest = candidate;
        nearestDistance = distance;
      }
    });
    return nearest;
  }

  function snapCaptureCrop(crop, videoWidth, videoHeight, threshold) {
    const bounded = clampCaptureCrop(crop, videoWidth, videoHeight);
    const x = nearestSnap(bounded.x, [
      0,
      (videoWidth - bounded.size) / 2,
      videoWidth / 3 - bounded.size / 2,
      videoWidth * 2 / 3 - bounded.size / 2,
      videoWidth - bounded.size,
    ], threshold);
    const y = nearestSnap(bounded.y, [
      0,
      (videoHeight - bounded.size) / 2,
      videoHeight / 3 - bounded.size / 2,
      videoHeight * 2 / 3 - bounded.size / 2,
      videoHeight - bounded.size,
    ], threshold);
    return clampCaptureCrop({ ...bounded, x, y }, videoWidth, videoHeight);
  }

  function normalizedCaptureCrop(crop, videoWidth, videoHeight) {
    const bounded = clampCaptureCrop(crop, videoWidth, videoHeight);
    return {
      centerX: (bounded.x + bounded.size / 2) / videoWidth,
      centerY: (bounded.y + bounded.size / 2) / videoHeight,
      size: bounded.size / Math.min(videoWidth, videoHeight),
    };
  }

  function restoredCaptureCrop(normalized, videoWidth, videoHeight) {
    if (![normalized?.centerX, normalized?.centerY, normalized?.size].every(Number.isFinite)
      || normalized.centerX < 0 || normalized.centerX > 1
      || normalized.centerY < 0 || normalized.centerY > 1
      || normalized.size <= 0 || normalized.size > 1) return null;
    const size = normalized.size * Math.min(videoWidth, videoHeight);
    return clampCaptureCrop({
      x: normalized.centerX * videoWidth - size / 2,
      y: normalized.centerY * videoHeight - size / 2,
      size,
    }, videoWidth, videoHeight);
  }

  function dragCaptureCrop(start, end, displayRect, videoWidth, videoHeight) {
    const left = Math.max(0, Math.min(start.x, end.x, displayRect.width));
    const top = Math.max(0, Math.min(start.y, end.y, displayRect.height));
    const width = Math.min(Math.abs(end.x - start.x), displayRect.width - left);
    const height = Math.min(Math.abs(end.y - start.y), displayRect.height - top);
    const size = Math.min(width, height);
    const scale = videoWidth / displayRect.width;
    return clampCaptureCrop({ x: left * scale, y: top * scale, size: size * scale }, videoWidth, videoHeight);
  }

  function selectionRectForCrop(crop, displayRect, videoWidth, videoHeight) {
    const scale = displayRect.width / videoWidth;
    return { x: displayRect.x + crop.x * scale, y: displayRect.y + crop.y * scale, size: crop.size * scale };
  }

  return {
    centeredCaptureCrop,
    clampCaptureCrop,
    defaultCaptureCrop,
    displayRectForVideo,
    dragCaptureCrop,
    moveCaptureCrop,
    normalizedCaptureCrop,
    resizeCaptureCrop,
    resizeCaptureCropFromCenter,
    restoredCaptureCrop,
    selectionRectForCrop,
    snapCaptureCrop,
  };
}));
