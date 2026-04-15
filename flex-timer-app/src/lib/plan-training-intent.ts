/**
 * Firestore `trainingIntent` for non-personal workout plans: store **0** or **1** (numbers only).
 * 0 = private training, 1 = group training. Legacy string values may exist in older documents; readers normalize them.
 */

export function normalizePlanTrainingIntentFromFirestore(raw: unknown): 0 | 1 | null {
  if (raw === 0 || raw === '0') return 0
  if (raw === 1 || raw === '1') return 1
  if (raw === 'group') return 1
  if (raw === 'private') return 0
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const n = Math.trunc(raw)
    if (n === 0 || n === 1) return n as 0 | 1
  }
  return null
}

/** Mutates a plan snapshot so `trainingIntent` is a numeric 0|1 (or removed for personal plans). */
export function sanitizeTrainingIntentOnPlanPayloadForFirestoreWrite(
  payload: Record<string, unknown>
): void {
  if (payload.isPersonal === true) {
    delete payload.trainingIntent
    return
  }
  const n = normalizePlanTrainingIntentFromFirestore(payload.trainingIntent)
  payload.trainingIntent = n === 1 ? 1 : 0
}
