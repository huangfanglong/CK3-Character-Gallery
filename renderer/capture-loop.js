function captureLoopBlendWeight(index, count) {
  if (!Number.isInteger(index) || !Number.isInteger(count) || count < 2 || index < 0 || index >= count) {
    throw new Error('Loop blend requires an index within at least two frames.');
  }
  const progress = index / (count - 1);
  return 3 * progress ** 2 - 2 * progress ** 3;
}

function captureLoopOutputPlan(frameCount, overlapFrames) {
  if (!Number.isInteger(frameCount) || !Number.isInteger(overlapFrames) || overlapFrames < 2 || frameCount < overlapFrames * 2) {
    throw new Error('A loop requires at least twice the overlap frame count.');
  }
  const indexes = (start, end) => Array.from({ length: end - start }, (_unused, index) => start + index);
  return {
    body: indexes(overlapFrames, frameCount - overlapFrames),
    tail: indexes(frameCount - overlapFrames, frameCount),
    head: indexes(0, overlapFrames),
  };
}

function captureLoopAppearanceDistance(reference, candidate) {
  if (!reference || !candidate || reference.length !== candidate.length || !reference.length) throw new Error('Loop descriptors must be non-empty and equal in length.');
  let total = 0;
  for (let index = 0; index < reference.length; index += 1) total += Math.abs(reference[index] - candidate[index]);
  return total / reference.length;
}

function captureLoopMotionDistance(referenceWindow, candidateWindow) {
  let total = 0;
  let samples = 0;
  for (let frame = 1; frame < referenceWindow.length; frame += 1) {
    const previousReference = referenceWindow[frame - 1];
    const previousCandidate = candidateWindow[frame - 1];
    const reference = referenceWindow[frame];
    const candidate = candidateWindow[frame];
    if (reference.length !== candidate.length || previousReference.length !== previousCandidate.length || reference.length !== previousReference.length) {
      throw new Error('Loop descriptor windows must have matching dimensions.');
    }
    for (let index = 0; index < reference.length; index += 1) {
      total += Math.abs((reference[index] - previousReference[index]) - (candidate[index] - previousCandidate[index]));
      samples += 1;
    }
  }
  return samples ? total / samples : 0;
}

function captureLoopMatchScore(referenceWindow, candidateWindow) {
  if (!Array.isArray(referenceWindow) || !Array.isArray(candidateWindow) || referenceWindow.length < 2 || referenceWindow.length !== candidateWindow.length) {
    throw new Error('Loop matching requires equally sized temporal windows.');
  }
  const appearance = referenceWindow.reduce((total, reference, index) => total + captureLoopAppearanceDistance(reference, candidateWindow[index]), 0) / referenceWindow.length;
  const motion = captureLoopMotionDistance(referenceWindow, candidateWindow);
  const anchorIndex = Math.floor(referenceWindow.length / 2);
  return { anchor: captureLoopAppearanceDistance(referenceWindow[anchorIndex], candidateWindow[anchorIndex]), appearance, motion, score: 0.65 * appearance + 0.35 * motion };
}

function createLiveCaptureLoopProcessor({ encoder, fps = LIVE_CAPTURE_FPS, settings = {}, createFrame = null, createDescriptor = null, createBlendCanvas = null, now = () => performance.now() } = {}) {
  if (!encoder?.encode || !encoder?.finalize || !Number.isFinite(fps) || fps <= 0) throw new Error('Live capture loop processor requires an encoder and a positive frame rate.');
  const options = {
    overlapFrames: settings.overlapFrames ?? LIVE_CAPTURE_LOOP_OVERLAP_FRAMES,
    beforeFrames: settings.beforeFrames ?? LIVE_CAPTURE_LOOP_MATCH_BEFORE_FRAMES,
    afterFrames: settings.afterFrames ?? LIVE_CAPTURE_LOOP_MATCH_AFTER_FRAMES,
    minBodyFrames: settings.minBodyFrames ?? LIVE_CAPTURE_LOOP_MIN_BODY_FRAMES,
    descriptorSize: settings.descriptorSize ?? LIVE_CAPTURE_LOOP_DESCRIPTOR_SIZE,
    anchorMaxDistance: settings.anchorMaxDistance ?? LIVE_CAPTURE_LOOP_ANCHOR_MAX_DISTANCE,
    windowMaxDistance: settings.windowMaxDistance ?? LIVE_CAPTURE_LOOP_WINDOW_MAX_DISTANCE,
    motionMaxDistance: settings.motionMaxDistance ?? LIVE_CAPTURE_LOOP_MOTION_MAX_DISTANCE,
    scoreMax: settings.scoreMax ?? LIVE_CAPTURE_LOOP_SCORE_MAX,
  };
  if (!Number.isInteger(options.overlapFrames) || options.overlapFrames < 2 || !Number.isInteger(options.beforeFrames) || !Number.isInteger(options.afterFrames)) {
    throw new Error('Live capture loop settings are invalid.');
  }
  const frameDuration = Math.round(1_000_000 / fps);
  const matchLookaheadMs = Math.ceil(options.afterFrames * 1_000 / fps);
  const tailCapacity = Math.max(options.overlapFrames + 1, options.beforeFrames + options.afterFrames + 1);
  const head = [];
  const tail = [];
  let referenceWindow = null;
  let search = null;
  let bestCandidate = null;
  let decision = null;
  let acceptedFrames = 0;
  let outputFrames = 0;
  let firstOutputTimestamp = null;
  let lastOutputTimestamp = -1;
  let analysisCanvas = null;
  let blendCanvas = null;
  let closed = false;

  const closeEntry = (entry) => {
    if (!entry || entry.closed) return;
    entry.closed = true;
    entry.frame.close();
  };
  const closeEntries = (entries) => { entries.splice(0).forEach(closeEntry); };
  const makeFrame = createFrame || ((source, timestamp) => new VideoFrame(source, { timestamp, duration: frameDuration, alpha: 'discard' }));
  const describe = createDescriptor || ((frame) => {
    analysisCanvas ||= document.createElement('canvas');
    analysisCanvas.width = options.descriptorSize;
    analysisCanvas.height = options.descriptorSize;
    const context = analysisCanvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(frame, 0, 0, options.descriptorSize, options.descriptorSize);
    const pixels = context.getImageData(0, 0, options.descriptorSize, options.descriptorSize).data;
    const descriptor = new Float32Array(options.descriptorSize * options.descriptorSize * 3);
    for (let sourceIndex = 0, targetIndex = 0; sourceIndex < pixels.length; sourceIndex += 4) {
      const red = pixels[sourceIndex] / 255;
      const green = pixels[sourceIndex + 1] / 255;
      const blue = pixels[sourceIndex + 2] / 255;
      const luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      descriptor[targetIndex] = luma;
      descriptor[targetIndex + 1] = (blue - luma) / 1.8556;
      descriptor[targetIndex + 2] = (red - luma) / 1.5748;
      targetIndex += 3;
    }
    return descriptor;
  });

  const encode = (source, timestamp) => {
    const normalizedTimestamp = outputFrames === 0 ? 0 : Math.max(timestamp - firstOutputTimestamp, lastOutputTimestamp + 1);
    if (outputFrames === 0) firstOutputTimestamp = timestamp;
    encoder.encode(source, normalizedTimestamp, outputFrames);
    lastOutputTimestamp = normalizedTimestamp;
    outputFrames += 1;
  };
  const encodeEntry = (entry) => {
    try { encode(entry.frame, entry.timestamp); }
    finally { closeEntry(entry); }
  };
  const buildReferenceWindow = () => {
    if (referenceWindow) return;
    const required = options.beforeFrames + options.afterFrames + 1;
    const opening = [...head, ...tail].slice(options.overlapFrames - options.beforeFrames, options.overlapFrames - options.beforeFrames + required);
    if (opening.length === required) referenceWindow = opening.map((entry) => ({ descriptor: entry.descriptor, captureTick: entry.captureTick }));
  };
  const matchingCandidate = () => {
    if (!search || !referenceWindow || tail.length < options.beforeFrames + options.afterFrames + 1) return null;
    const candidateIndex = tail.length - options.afterFrames - 1;
    const candidate = tail[candidateIndex];
    if (candidate.index < search.requestedIndex || candidate.index < options.overlapFrames + options.minBodyFrames) return null;
    const candidateWindow = tail.slice(candidateIndex - options.beforeFrames, candidateIndex + options.afterFrames + 1);
    const isConsecutive = (window) => window.every((entry, index) => index === 0 || entry.captureTick === window[index - 1].captureTick + 1);
    if (candidateWindow.length !== referenceWindow.length || !isConsecutive(referenceWindow) || !isConsecutive(candidateWindow)) return null;
    const score = captureLoopMatchScore(referenceWindow.map((entry) => entry.descriptor), candidateWindow.map((entry) => entry.descriptor));
    if (score.anchor > options.anchorMaxDistance || score.appearance > options.windowMaxDistance || score.motion > options.motionMaxDistance || score.score > options.scoreMax) return null;
    return { candidate, score };
  };
  const ensureBlendCanvas = () => {
    blendCanvas ||= createBlendCanvas?.() || document.createElement('canvas');
    blendCanvas.width = 450;
    blendCanvas.height = 450;
    return blendCanvas;
  };
  const writeFallback = () => {
    if (acceptedFrames < options.overlapFrames * 2) throw new Error('Capture is too short to create a smooth loop.');
    while (tail.length > options.overlapFrames) encodeEntry(tail.shift());
    const canvas = ensureBlendCanvas();
    const context = canvas.getContext('2d');
    for (let index = 0; index < options.overlapFrames; index += 1) {
      const weight = captureLoopBlendWeight(index, options.overlapFrames);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.globalAlpha = 1 - weight;
      context.drawImage(tail[index].frame, 0, 0, canvas.width, canvas.height);
      context.globalAlpha = weight;
      context.drawImage(head[index].frame, 0, 0, canvas.width, canvas.height);
      context.globalAlpha = 1;
      encode(canvas, outputFrames === 0 ? 0 : lastOutputTimestamp + frameDuration + (firstOutputTimestamp ?? 0));
    }
    closeEntries(tail);
  };

  return {
    get acceptedFrames() { return acceptedFrames; },
    get decision() { return decision; },
    get isReady() { return acceptedFrames >= options.overlapFrames * 2; },
    beginSearch({ requestedIndex, deadline }) {
      if (closed || decision || !Number.isInteger(requestedIndex) || !Number.isFinite(deadline)) return false;
      tail.forEach((entry) => { entry.descriptor ||= describe(entry.frame); });
      search = { requestedIndex, deadline, lookaheadDeadline: deadline + matchLookaheadMs };
      return true;
    },
    push(source, { sourceTimestamp, captureTick }) {
      if (closed || decision) return decision;
      if (search && now() > search.lookaheadDeadline) {
        return this.completeSearch();
      }
      const entry = { frame: makeFrame(source, sourceTimestamp), timestamp: sourceTimestamp, captureTick, index: acceptedFrames, descriptor: null, closed: false };
      acceptedFrames += 1;
      try {
        if (entry.index < options.overlapFrames + options.afterFrames + 1 || search) entry.descriptor = describe(entry.frame);
      } catch (error) { closeEntry(entry); throw error; }
      if (head.length < options.overlapFrames) head.push(entry);
      else tail.push(entry);
      buildReferenceWindow();
      const match = matchingCandidate();
      if (match && (!bestCandidate || match.score.score < bestCandidate.score.score)) bestCandidate = match;
      if (!decision) while (tail.length > tailCapacity) encodeEntry(tail.shift());
      return decision;
    },
    forceFallback() {
      if (!decision) decision = 'fallback';
      return decision;
    },
    completeSearch() {
      if (!decision) decision = bestCandidate ? 'natural' : 'fallback';
      return decision;
    },
    async finalize() {
      if (closed) throw new Error('Live capture loop processor is closed.');
      try {
        if (decision !== 'natural') {
          decision = 'fallback';
          writeFallback();
        } else {
          while (tail[0] && tail[0].index < bestCandidate.candidate.index) encodeEntry(tail.shift());
          if (tail[0] === bestCandidate.candidate) encodeEntry(tail.shift());
          closeEntries(tail);
        }
        const endTimestamp = decision === 'natural'
          ? Math.max(0, bestCandidate.candidate.timestamp - firstOutputTimestamp)
          : Infinity;
        return await encoder.finalize({ endTimestamp, appendDurationMarker: true, remux: true });
      } finally {
        closeEntries(head);
        closeEntries(tail);
        closed = true;
      }
    },
    close() {
      if (closed) return;
      closed = true;
      closeEntries(head);
      closeEntries(tail);
    },
  };
}
