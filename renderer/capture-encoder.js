const LIVE_CAPTURE_CODEC = 'vp09.00.10.08';
const LIVE_CAPTURE_FRAME_DURATION_US = Math.round(1_000_000 / LIVE_CAPTURE_FPS);
const LIVE_CAPTURE_KEY_FRAME_INTERVAL = LIVE_CAPTURE_FPS * 2;
const LIVE_CAPTURE_MAX_ENCODE_QUEUE = 3;

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

async function createLiveCaptureEncoder() {
  if (!globalThis.VideoEncoder || !globalThis.VideoFrame || !globalThis.WebMMuxer) {
    throw new Error('This Electron build cannot encode WebM video with WebCodecs.');
  }
  const support = await VideoEncoder.isConfigSupported(liveCaptureEncoderConfig());
  if (!support.supported) throw new Error('This Electron build does not support the required VP9 encoder.');

  const target = new globalThis.WebMMuxer.ArrayBufferTarget();
  const muxer = new globalThis.WebMMuxer.Muxer({
    target,
    video: { codec: 'V_VP9', width: 450, height: 450, frameRate: LIVE_CAPTURE_FPS },
    firstTimestampBehavior: 'strict',
  });
  let error = null;
  const encoder = new VideoEncoder({
    output: (chunk, metadata) => muxer.addVideoChunk(chunk, metadata),
    error: (cause) => { error = cause; },
  });
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
    async finalize() {
      try {
        await encoder.flush();
        if (error) throw error;
        muxer.finalize();
        if (target.buffer.byteLength > 75 * 1024 * 1024) throw new Error('Captured video exceeds the 75 MiB limit.');
        return target.buffer;
      } finally {
        if (encoder.state !== 'closed') encoder.close();
      }
    },
    close() {
      if (encoder.state !== 'closed') encoder.close();
    },
  };
}
