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

  return { clampCaptureCrop, defaultCaptureCrop, displayRectForVideo, dragCaptureCrop, selectionRectForCrop };
}));
