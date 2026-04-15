export type PublicUserProfileHubRow = { label: string; value: string }

/** Present on GET public-profile when the target is not the signed-in user. */
export type ViewerConnectionState = {
  connected: boolean
  outgoingRequestPending: boolean
  incomingRequestPending: boolean
}

export type PublicUserProfileView = {
  userId: string
  displayName: string
  handle: string | null
  bio: string | null
  profilePhotoUrl: string | null
  city: string | null
  region: string | null
  country: string | null
  hubLookups: PublicUserProfileHubRow[]
  viewerConnection?: ViewerConnectionState
}
