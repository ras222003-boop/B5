import type { ObjectColorName } from "@shared/vision";
// Canvas is sampled in sRGB. LUT avoids three gamma powers per sampled pixel.
const linear = Float64Array.from({ length: 256 }, (_, v) => {
  const s = v / 255;
  return s > 0.04045 ? ((s + 0.055) / 1.055) ** 2.4 : s / 12.92;
});
export function rgbToLab(
  r: number,
  g: number,
  b: number
): [number, number, number] {
  const R = linear[r],
    G = linear[g],
    B = linear[b],
    f = (v: number) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
  const x = f((0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047),
    y = f(0.2126729 * R + 0.7151522 * G + 0.072175 * B),
    z = f((0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
export function pixelColour(
  r: number,
  g: number,
  b: number,
  lab = rgbToLab(r, g, b)
): ObjectColorName {
  const [L, a, z] = lab,
    chroma = Math.hypot(a, z);
  if (chroma < 12 && L < 30) return "black";
  if (chroma < 12) return L > 85 ? "white" : "gray";
  const max = Math.max(r, g, b) / 255,
    min = Math.min(r, g, b) / 255,
    delta = max - min,
    s = max ? delta / max : 0;
  let h =
    delta === 0
      ? 0
      : max === r / 255
        ? 60 * (((g - b) / 255 / delta) % 6)
        : max === g / 255
          ? 60 * ((b - r) / 255 / delta + 2)
          : 60 * ((r - g) / 255 / delta + 4);
  if (h < 0) h += 360;
  // Darkness alone must not turn a saturated navy/red material into black.
  if (s < 0.16) return max > 0.84 ? "white" : L < 30 ? "black" : "gray";
  if (h >= 15 && h < 65 && max < 0.65) return "brown";
  if (h < 15 || h >= 345) return max > 0.7 && s < 0.55 ? "pink" : "red";
  if (h < 42) return "orange";
  if (h < 68) return "yellow";
  if (h < 170) return "green";
  if (h < 260) return "blue";
  if (h < 300) return "purple";
  return "pink";
}
export function hsvLabel(r: number, g: number, b: number): ObjectColorName {
  return pixelColour(r, g, b);
}
