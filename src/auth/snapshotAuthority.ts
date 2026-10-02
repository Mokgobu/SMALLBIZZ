type SnapshotMetadata = {
  fromCache: boolean
  hasPendingWrites: boolean
}

export function isAuthoritativeSnapshot(metadata: SnapshotMetadata) {
  return !metadata.fromCache && !metadata.hasPendingWrites
}
