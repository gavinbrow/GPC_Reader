import type { Solvent } from '../afe8/types';

/** Common SEC solvents: refractive index at 658 nm / 25 °C and viscosity (cP). */
export const SOLVENT_LIBRARY: { name: string; n: number; dndT: number; viscosity: number; description: string }[] = [
  { name: 'THF', n: 1.4027, dndT: -3.8e-4, viscosity: 0.46, description: 'Tetrahydrofuran (C4H8O)' },
  { name: 'water', n: 1.3310, dndT: -1.0e-4, viscosity: 0.89, description: 'Water / aqueous buffers (PBS ~1.334)' },
  { name: 'PBS', n: 1.3340, dndT: -1.0e-4, viscosity: 0.89, description: 'Phosphate buffered saline' },
  { name: 'toluene', n: 1.4906, dndT: -5.5e-4, viscosity: 0.56, description: 'Toluene (C7H8)' },
  { name: 'DMF', n: 1.4270, dndT: -4.0e-4, viscosity: 0.80, description: 'N,N-Dimethylformamide' },
  { name: 'DMAc', n: 1.4340, dndT: -4.0e-4, viscosity: 0.92, description: 'N,N-Dimethylacetamide' },
  { name: 'DMSO', n: 1.4730, dndT: -4.0e-4, viscosity: 1.99, description: 'Dimethyl sulfoxide' },
  { name: 'chloroform', n: 1.4420, dndT: -5.9e-4, viscosity: 0.54, description: 'Chloroform (CHCl3)' },
  { name: 'dichloromethane', n: 1.4210, dndT: -5.5e-4, viscosity: 0.41, description: 'Dichloromethane (CH2Cl2)' },
  { name: 'HFIP', n: 1.2750, dndT: -3.5e-4, viscosity: 1.65, description: 'Hexafluoroisopropanol' },
  { name: 'TCB', n: 1.5680, dndT: -4.5e-4, viscosity: 1.40, description: '1,2,4-Trichlorobenzene (25 °C)' },
  { name: 'NMP', n: 1.4670, dndT: -4.0e-4, viscosity: 1.67, description: 'N-Methyl-2-pyrrolidone' },
  { name: 'methanol', n: 1.3270, dndT: -4.0e-4, viscosity: 0.54, description: 'Methanol' },
  { name: 'acetone', n: 1.3570, dndT: -5.0e-4, viscosity: 0.31, description: 'Acetone' },
];

/**
 * Refractive index of the solvent at wavelength `lambda` (nm, vacuum) and
 * temperature `T` (°C).
 *
 * ASTRA's solvent model 9 stores [n0, B, C, D, dn/dT, T0] for a Cauchy
 * dispersion referenced to the solvent reference wavelength:
 *   n = n0 + B (1/λ² − 1/λ0²) + C (1/λ⁴ − 1/λ0⁴) − dn/dT (T − T0)   (λ in µm)
 * Other/unknown models fall back to the built-in solvent library.
 */
export function solventRefractiveIndex(s: Solvent, lambda: number, T: number): number {
  const p = s.refractiveIndexParams;
  if (p.length >= 1 && p[0] > 1 && p[0] < 2) {
    const l = lambda / 1000;
    const l0 = (s.referenceWavelength || 658) / 1000;
    const B = p[1] ?? 0;
    const C = p[2] ?? 0;
    const dndT = p.length >= 6 ? p[4] : 0;
    const T0 = p.length >= 6 ? p[5] : s.referenceTemperature || 25;
    let n = p[0] + B * (1 / l ** 2 - 1 / l0 ** 2) + C * (1 / l ** 4 - 1 / l0 ** 4) - dndT * (T - T0);
    if (!(n > 1 && n < 2)) n = p[0];
    return n;
  }
  const lib = SOLVENT_LIBRARY.find((x) => x.name.toLowerCase() === s.name.toLowerCase());
  if (lib) return lib.n + lib.dndT * (T - 25);
  return 1.333;
}
