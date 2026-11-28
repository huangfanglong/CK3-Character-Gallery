/* Dock strip placement shared by the main process (native window shape via
   dockSurfaceBounds) and the dock renderer (hit regions and hover strip), so the
   clickable native region and the renderer's hover geometry can never disagree —
   including on game windows narrower than the resting strip. */
(function gameDockGeometryModule(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined') module.exports = api;
  Object.assign(root, api);
}(typeof globalThis === 'undefined' ? this : globalThis, () => {
  const DOCK_STRIP_MARGIN = 12;
  const DOCK_STRIP_MIN_WIDTH = 120;
  const DOCK_RESTING_WIDTH = 280;
  const DOCK_EXPANDED_WIDTH = 680;

  /* Returns the dock's horizontal placement relative to the game window's left
     edge. Resting and retracted strips use the narrow footprint; a revealed
     panel claims the wide one. Very small windows floor at the minimum width
     instead of overflowing the window or disagreeing across processes. */
  function dockSurfacePlacement(windowWidth, mode = 'compact', position = 'center', revealed = false) {
    const resting = !revealed && ['compact', 'framing'].includes(mode);
    const width = Math.min(resting ? DOCK_RESTING_WIDTH : DOCK_EXPANDED_WIDTH, Math.max(DOCK_STRIP_MIN_WIDTH, windowWidth - DOCK_STRIP_MARGIN * 2));
    const availableX = windowWidth - width - DOCK_STRIP_MARGIN * 2;
    const offset = position === 'left' ? 0 : position === 'right' ? availableX : availableX / 2;
    return { x: DOCK_STRIP_MARGIN + offset, width };
  }

  return { dockSurfacePlacement };
}));
