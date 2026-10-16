/** Pure image geometry. Camera direction is not the user's direction of travel. */
export function imagePosition(box) {
  if (
    !Array.isArray(box) ||
    box.length !== 4 ||
    !box.every(Number.isFinite) ||
    box[0] < 0 ||
    box[1] < 0 ||
    box[2] <= 0 ||
    box[3] <= 0 ||
    box[0] + box[2] > 1 ||
    box[1] + box[3] > 1
  )
    throw new Error("Valid normalized stairs box required");
  const [x, , width] = box,
    center = x + width / 2;
  return {
    horizontal: center < 1 / 3 ? "left" : center < 2 / 3 ? "center" : "right",
    overlapsCentralImageRegion: x < 2 / 3 && x + width > 1 / 3,
    space: "image-relative-only",
    metricDistance: null,
    walkingPathKnown: false,
  };
}
