/** Dispatched when the signed-in user’s connection list may have changed (e.g. accepted a request). */
export const CONNECTIONS_LIST_REFRESH_EVENT = 'flextimer-connections-list-refresh'

export function notifyConnectionsListRefresh(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CONNECTIONS_LIST_REFRESH_EVENT))
  }
}
