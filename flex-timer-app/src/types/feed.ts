/** Values written by the iOS app and web to `groups/{groupId}/feed/*` and `users/{uid}/feed/*`. */
export type AppFeedItemType =
  | 'sharePlan'
  | 'shareCollection'
  | 'shareWorkout'
  | 'joinGroup'
  | 'leaveGroup'
  | 'userConnect'
  | 'createGroup'
  | 'unknown'

/** Resolved share target for feed rows (workout / plan / collection). */
export type AppFeedSharedResource = {
  kind: 'workout' | 'collection' | 'plan'
  ownerUserId: string
  resourceId: string
  label: string
}

/** Personal-feed direct shares (plan / collection / workout): who to link in the headline. */
export type AppFeedSharePlanPersonalPresentation = {
  variant: 'you_shared_with' | 'peer_shared'
  profileUserId: string
  profileDisplayName: string
  resourceKind: 'plan' | 'collection' | 'workout'
}

/** Hub feed: another member shared a library item — linked actor name + object kind (no “with you”). */
export type AppFeedGroupShareHeadline = {
  profileUserId: string
  profileDisplayName: string
  resourceKind: 'plan' | 'collection' | 'workout'
}

/** Personal-feed `userConnect` rows (e.g. `actionType: connect`): who to link in the headline. */
export type AppFeedUserConnectPersonalPresentation = {
  variant: 'peer_connected_with_you' | 'you_connected_with_peer'
  profileUserId: string
  profileDisplayName: string
}

export type AppFeedItemResponse = {
  id: string
  /** Hub id for group feed rows; empty string for the signed-in user’s personal `users/{uid}/feed` rows. */
  groupId: string
  /** Hub display name, or `Connection` for items from the signed-in user’s personal `users/{uid}/feed` stream. */
  groupName: string
  type: AppFeedItemType
  createdAt: string
  title: string
  actorUserId: string
  actorDisplayName: string
  actorPhotoUrl: string | null
  /** Direct (connection) shares on the viewer’s personal feed. */
  sharePlanPersonalPresentation?: AppFeedSharePlanPersonalPresentation
  /** Hub feed when someone else shared a plan/collection/workout to the group. */
  groupShareHeadline?: AppFeedGroupShareHeadline
  /** Set for connection events on the viewer’s personal feed. */
  userConnectPersonalPresentation?: AppFeedUserConnectPersonalPresentation
  planName?: string | null
  collectionName?: string | null
  workoutName?: string | null
  /** Optional message / caption from the share payload (nested maps scanned). */
  shareComment?: string | null
  /** When the row is a share event, the library item that was shared (for linking / preview). */
  sharedResource?: AppFeedSharedResource | null
}

export type AppFeedPageResponse = {
  items: AppFeedItemResponse[]
  nextCursor: string | null
  hasMore: boolean
  truncatedGroups: boolean
  eligibleGroupCount: number
  queriedGroupCount: number
}
