import { trapz } from './math';

export interface PeakStats {
  retentionTime: number; // min, at maximum
  retentionVolume: number; // mL
  height: number;
  area: number; // signal·min
  centroid: number; // min (first moment)
  sigma: number; // min (sqrt of second central moment)
  fwhm: number; // min
  width10: number; // min, at 10% height
  width5: number; // min, at 5% height
  plates: number; // 5.545 (tR/W½)²
  asymmetry: number; // b/a at 10% height
  tailing: number; // (a+b)/2a at 5% height (USP)
}

/** Column-performance statistics of a baseline-corrected signal over [i0, i1]. */
export function peakStatistics(t: ArrayLike<number>, y: ArrayLike<number>, i0: number, i1: number, flow: number): PeakStats {
  let imax = -1;
  let h = -Infinity;
  for (let i = i0; i <= i1; i++) if (Number.isFinite(y[i]) && y[i] > h) {
    h = y[i];
    imax = i;
  }
  const nanStats: PeakStats = {
    retentionTime: NaN, retentionVolume: NaN, height: NaN, area: NaN, centroid: NaN, sigma: NaN,
    fwhm: NaN, width10: NaN, width5: NaN, plates: NaN, asymmetry: NaN, tailing: NaN,
  };
  if (imax < 0 || !(h > 0)) return { ...nanStats, area: i1 > i0 ? trapz(t, y, i0, i1) : NaN };
  const area = trapz(t, y, i0, i1);
  let m1 = 0;
  let m0 = 0;
  for (let i = i0 + 1; i <= i1; i++) {
    const a = y[i - 1];
    const b = y[i];
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const dt = t[i] - t[i - 1];
    m0 += 0.5 * (a + b) * dt;
    m1 += 0.5 * (a * t[i - 1] + b * t[i]) * dt;
  }
  const centroid = m1 / m0;
  let m2 = 0;
  for (let i = i0 + 1; i <= i1; i++) {
    const a = y[i - 1];
    const b = y[i];
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    m2 += 0.5 * (a * (t[i - 1] - centroid) ** 2 + b * (t[i] - centroid) ** 2) * (t[i] - t[i - 1]);
  }
  const sigma = Math.sqrt(Math.max(0, m2 / m0));
  const cross = (frac: number): [number, number] => {
    const lv = frac * h;
    let j = imax;
    while (j > i0 && y[j] > lv) j--;
    const a = y[j] <= lv && y[j + 1] !== y[j] ? t[j] + ((lv - y[j]) * (t[j + 1] - t[j])) / (y[j + 1] - y[j]) : NaN;
    let k = imax;
    while (k < i1 && y[k] > lv) k++;
    const b = y[k] <= lv && y[k - 1] !== y[k] ? t[k] - ((lv - y[k]) * (t[k] - t[k - 1])) / (y[k - 1] - y[k]) : NaN;
    return [a, b];
  };
  const tr = t[imax];
  const [a50, b50] = cross(0.5);
  const [a10, b10] = cross(0.1);
  const [a5, b5] = cross(0.05);
  const fwhm = b50 - a50;
  return {
    retentionTime: tr,
    retentionVolume: tr * flow,
    height: h,
    area,
    centroid,
    sigma,
    fwhm,
    width10: b10 - a10,
    width5: b5 - a5,
    plates: 5.545 * (tr / fwhm) ** 2,
    asymmetry: (b10 - tr) / (tr - a10),
    tailing: (b5 - a5) / (2 * (tr - a5)),
  };
}
