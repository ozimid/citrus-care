// Before/after slider geometry (plant detail screen). Same position math as
// the web BeforeAfterSlider (x within container width → percentage), but the
// handle is clamped to 8–92% so a sliver of both photos always stays visible
// under a thumb. Pure module (tested); the PanResponder + width-clip rendering
// lives in src/components/BeforeAfterSlider.tsx.

export const SLIDER_MIN = 8;
export const SLIDER_MAX = 92;
export const INITIAL_SLIDER_POSITION = 50;

export function clampSliderPosition(position: number): number {
  return Math.max(SLIDER_MIN, Math.min(SLIDER_MAX, position));
}

/** Touch x (px from the container's left edge) → clamped percentage. Before
 * layout reports a width, stay centered rather than dividing by zero. */
export function sliderPositionFromX(x: number, containerWidth: number): number {
  if (containerWidth <= 0) return INITIAL_SLIDER_POSITION;
  return clampSliderPosition((x / containerWidth) * 100);
}
