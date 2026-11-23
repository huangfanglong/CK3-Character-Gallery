let activePortraitWave = null;

function playQuickLookWave() {
  const root = document.querySelector('.quick-sheet');
  const content = root?.querySelector('.quick-look-wave-content');
  const WaveController = window.DistortionWaves?.WaveController;
  if (!root || !content || !WaveController) return;

  activePortraitWave?.destroy();
  const wave = new WaveController(root, content);
  activePortraitWave = wave;
  wave.update({
    type: 'vertical',
    palette: 'colorful',
    waveStyle: { travel: 1.55, anticipation: 0.12, pull: 18, inhale: 36 },
    onFinish: () => {
      if (activePortraitWave !== wave) return;
      wave.destroy();
      activePortraitWave = null;
    },
  });
  const width = root.clientWidth;
  const height = root.clientHeight;
  const sourceSize = Math.min(58, width * 0.2);
  wave.play({
    source: {
      x: (width - sourceSize) / 2,
      y: height - sourceSize / 2,
      w: sourceSize,
      h: sourceSize,
    },
  });
}
