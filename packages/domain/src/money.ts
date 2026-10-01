/** Round to cents, guarding the binary-fraction edge (1.005 → 1.01). */
export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
