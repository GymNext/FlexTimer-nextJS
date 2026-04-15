import { parseFirestoreJoinPolicy, type AppGroupJoinPolicy } from '@/types/group'

const JOIN_POLICY_LABEL: Record<AppGroupJoinPolicy, string> = {
  private: 'private',
  restricted: 'restricted',
  public: 'public',
}

const SUBHUB_POLICY_LABEL: Record<AppGroupJoinPolicy, string> = {
  private: 'private sub hub',
  restricted: 'restricted sub hub',
  public: 'public sub hub',
}

function displayHandleLine(raw: string | null | undefined): string {
  if (raw == null) return ''
  const t = raw.trim()
  if (!t) return ''
  return t.startsWith('@') ? t : `@${t}`
}

/**
 * One-line hub summary for Hubs: `@handle • Private`, or `Private Sub Hub` style labels for sub hubs.
 */
export function formatHubSubtitle(
  handleRaw: string | null | undefined,
  joinPolicyRaw: string | null | undefined,
  isSubgroup?: boolean,
): string {
  const jp = parseFirestoreJoinPolicy(joinPolicyRaw)
  const policyLabel = jp ? JOIN_POLICY_LABEL[jp] : 'Unknown'
  const handleLine = displayHandleLine(handleRaw)
  if (handleLine) return `${handleLine} \u2022 ${policyLabel}`
  if (isSubgroup) return jp ? SUBHUB_POLICY_LABEL[jp] : 'Unknown Sub Hub'
  return policyLabel
}
