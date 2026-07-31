const LIVE_CAPTURE_CODEC = 'vp09.00.10.08';
const LIVE_CAPTURE_FRAME_DURATION_US = Math.round(1_000_000 / LIVE_CAPTURE_FPS);
const LIVE_CAPTURE_KEY_FRAME_INTERVAL = LIVE_CAPTURE_FPS * 2;
const LIVE_CAPTURE_MAX_ENCODE_QUEUE = 3;
const LIVE_CAPTURE_MAX_BUFFERED_BYTES = 75 * 1024 * 1024;

function liveCaptureEncoderConfig() {
  return {
    codec: LIVE_CAPTURE_CODEC,
    width: 450,
    height: 450,
    bitrate: LIVE_CAPTURE_VIDEO_BITRATE,
    framerate: LIVE_CAPTURE_FPS,
    bitrateMode: 'variable',
    latencyMode: 'quality',
    hardwareAcceleration: 'prefer-software',
    alpha: 'discard',
  };
}

async function createLiveCaptureEncoder({ bufferOnly = false } = {}) {
  if (!globalThis.VideoEncoder || !globalThis.VideoFrame || !globalThis.WebMMuxer) {
    throw new Error('This Electron build cannot encode WebM video with WebCodecs.');
  }
  const support = await VideoEncoder.isConfigSupported(liveCaptureEncoderConfig());
  if (!support.supported) throw new Error('This Electron build does not support the required VP9 encoder.');

  const target = bufferOnly ? null : new globalThis.WebMMuxer.ArrayBufferTarget();
  const muxer = bufferOnly ? null : new globalThis.WebMMuxer.Muxer({
    target,
    video: { codec: 'V_VP9', width: 450, height: 450, frameRate: LIVE_CAPTURE_FPS },
    firstTimestampBehavior: 'strict',
  });
  const chunks = [];
  let bufferedBytes = 0;
  let error = null;
  const captureChunk = (chunk, metadata) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      bufferedBytes += data.byteLength;
      if (bufferedBytes > LIVE_CAPTURE_MAX_BUFFERED_BYTES) {
        error = new Error('Captured video exceeds the 75 MiB limit.');
        return;
      }
      chunks.push({
        type: chunk.type,
        timestamp: chunk.timestamp,
        duration: chunk.duration,
        data,
        metadata,
      });
  };
  const encoder = bufferOnly
    ? new VideoEncoder({ output: captureChunk, error: (cause) => { error = cause; } })
    : new VideoEncoder({ output: (chunk, metadata) => muxer.addVideoChunk(chunk, metadata), error: (cause) => { error = cause; } });
  encoder.configure(support.config);

  return {
    get encodeQueueSize() { return encoder.encodeQueueSize; },
    get hasCapacity() { return encoder.encodeQueueSize <= LIVE_CAPTURE_MAX_ENCODE_QUEUE; },
    encode(canvas, timestamp, frameIndex) {
      if (error) throw error;
      const frame = new VideoFrame(canvas, {
        timestamp,
        duration: LIVE_CAPTURE_FRAME_DURATION_US,
        alpha: 'discard',
      });
      encoder.encode(frame, { keyFrame: frameIndex % LIVE_CAPTURE_KEY_FRAME_INTERVAL === 0 });
      frame.close();
    },
    async finalize({ endTimestamp = Infinity, appendDurationMarker = false, remux = false } = {}) {
      try {
        await encoder.flush();
        if (error) throw error;
        if (!bufferOnly) {
          muxer.finalize();
        }
        if (!bufferOnly || !remux) {
          if (target.buffer.byteLength > LIVE_CAPTURE_MAX_BUFFERED_BYTES) throw new Error('Captured video exceeds the 75 MiB limit.');
          return target.buffer;
        }
        const remuxTarget = new globalThis.WebMMuxer.ArrayBufferTarget();
        const remuxer = new globalThis.WebMMuxer.Muxer({
          target: remuxTarget,
          video: { codec: 'V_VP9', width: 450, height: 450, frameRate: LIVE_CAPTURE_FPS },
          firstTimestampBehavior: 'strict',
        });
        let added = 0;
        for (const entry of chunks) {
          if (entry.timestamp >= endTimestamp) break;
          remuxer.addVideoChunk(new EncodedVideoChunk(entry), entry.metadata);
          added += 1;
        }
        if (!added) throw new Error('Captured video did not contain any frames before the loop boundary.');
        if (appendDurationMarker) {
          const marker = Number.isFinite(endTimestamp)
            ? chunks.find((entry) => entry.timestamp >= endTimestamp)
            : chunks[0];
          if (marker) {
            if (Number.isFinite(endTimestamp)) remuxer.addVideoChunk(new EncodedVideoChunk(marker), marker.metadata);
            else {
              const lastChunk = chunks.at(-1);
              remuxer.addVideoChunk(new EncodedVideoChunk({
                type: marker.type,
                timestamp: lastChunk.timestamp + (lastChunk.duration || LIVE_CAPTURE_FRAME_DURATION_US),
                duration: marker.duration,
                data: marker.data,
              }), marker.metadata);
            }
          }
        }
        remuxer.finalize();
        if (remuxTarget.buffer.byteLength > LIVE_CAPTURE_MAX_BUFFERED_BYTES) throw new Error('Captured video exceeds the 75 MiB limit.');
        return remuxTarget.buffer;
      } finally {
        chunks.length = 0;
        bufferedBytes = 0;
        if (encoder.state !== 'closed') encoder.close();
      }
    },
    close() {
      chunks.length = 0;
      bufferedBytes = 0;
      if (encoder.state !== 'closed') encoder.close();
    },
  };
}
