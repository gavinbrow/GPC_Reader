/**
 * Display-level inter-detector processing: alignment (time shift) and band
 * broadening (Gaussian convolution).
 *
 * In a MALS/RI/UV train the detectors sit at different points in the flow path,
 * so a given slice of eluent reaches them at slightly different times (band
 * *delay*) and is progressively smeared by the connecting tubing (band
 * *broadening*).  ASTRA lets you correct for both before overlaying the traces.
 *
 * These helpers are pure and operate on the already-downsampled display arrays:
 *   - `shift` (minutes) is added to a detector's time axis to align its peak
 *     with the reference detector.
 *   - `broaden` (Gaussian sigma, minutes) convolves the signal to widen a
 *     sharper detector so it matches a broader one.
 */

export interface DetectorProcessing {
  shift?: number;
  broaden?: number;
}

/** Median spacing between consecutive time points (minutes). */
function medianDt(time: number[]): number {
  if (!time || time.length < 2) return 0;
  const diffs: number[] = [];
  for (let i = 1; i < time.length; i++) {
    const d = time[i] - time[i - 1];
    if (Number.isFinite(d) && d > 0) diffs.push(d);
  }
  if (diffs.length === 0) return 0;
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)];
}

/** Build a normalized 1-D Gaussian kernel for the given sigma (in samples). */
function gaussianKernel(sigmaSamples: number): number[] {
  const radius = Math.max(1, Math.ceil(sigmaSamples * 3));
  const kernel: number[] = [];
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / (2 * sigmaSamples * sigmaSamples));
    kernel.push(v);
    sum += v;
  }
  return kernel.map((v) => v / sum);
}

/**
 * Convolve a 1-D signal with a Gaussian of width `sigmaMinutes`, using the
 * time axis to convert minutes → samples.  Edges are handled by clamping
 * (nearest-value padding) so the trace keeps its length and endpoints.
 */
export function gaussianBroaden1d(
  y: number[],
  time: number[],
  sigmaMinutes: number,
): number[] {
  if (!sigmaMinutes || sigmaMinutes <= 0 || !y || y.length < 3) return y;
  const dt = medianDt(time);
  if (dt <= 0) return y;
  const sigmaSamples = sigmaMinutes / dt;
  if (sigmaSamples < 0.25) return y; // narrower than resolution — no-op
  const kernel = gaussianKernel(sigmaSamples);
  const radius = (kernel.length - 1) / 2;
  const n = y.length;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let k = -radius; k <= radius; k++) {
      let j = i + k;
      if (j < 0) j = 0;
      else if (j >= n) j = n - 1;
      const yj = y[j];
      acc += (Number.isFinite(yj) ? yj : 0) * kernel[k + radius];
    }
    out[i] = acc;
  }
  return out;
}

/** Apply a time shift (minutes) to a detector's time axis. */
export function applyShift(time: number[], shift: number): number[] {
  if (!shift || !time) return time;
  return time.map((t) => t + shift);
}

/** True when this detector has a non-trivial processing correction. */
export function hasProcessing(p: DetectorProcessing | undefined): boolean {
  if (!p) return false;
  return Boolean((p.shift && p.shift !== 0) || (p.broaden && p.broaden > 0));
}
