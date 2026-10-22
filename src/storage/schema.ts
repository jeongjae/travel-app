import type { Table } from 'dexie';
export const storesV2 = {
  workspace_meta: 'id', trip_headers: '[spaceId+tripId],[spaceId+startDate]',
  content_heads: '[spaceId+tripId+targetKind+entityId],[spaceId+tripId+targetKind+status]',
  content_revisions: '[spaceId+tripId+kind+entityId+revisionId],[spaceId+tripId+kind],[spaceId+tripId+commitSeq]',
  plan_versions: '[spaceId+tripId+planVersionId],&[spaceId+tripId+number],[spaceId+tripId+commitSeq]',
  plan_days: '[spaceId+tripId+planVersionId+dayId],&[spaceId+tripId+planVersionId+ordinal],[spaceId+tripId+planVersionId+date]',
  plan_items: '[spaceId+tripId+planVersionId+activityId],&[spaceId+tripId+planVersionId+dayId+order]',
  plan_legs: '[spaceId+tripId+planVersionId+legId],[spaceId+tripId+planVersionId+dayId]',
  plan_stays: '[spaceId+tripId+planVersionId+stayId],[spaceId+tripId+planVersionId+regionId]',
  field_records: '[spaceId+tripId+recordId],[spaceId+tripId+kind+recordedAt],&[spaceId+tripId+supersedes],[spaceId+tripId+commitSeq]',
  import_packages: '[spaceId+tripId+packageId],[spaceId+tripId+packageDigest]',
  import_heads: '[spaceId+tripId+lineageId+sourceKind+sourceKey]',
  import_mappings: '[spaceId+tripId+mappingRevisionId],[spaceId+tripId+lineageId],[spaceId+tripId+commitSeq]',
  proposal_heads: '[spaceId+tripId+proposalId],[spaceId+tripId+status]',
  proposal_revisions: '[spaceId+tripId+proposalId+proposalRevisionId],[spaceId+tripId+commitSeq]',
  command_receipts: '[spaceId+tripId+requestId],[spaceId+tripId+commitSeq]',
  asset_blobs: '[spaceId+tripId+sha256]', transfer_jobs: 'jobId,spaceId', staged_rows: '[jobId+collection+rowKey],jobId', snapshot_jobs: 'snapshotId,spaceId',
};
export type Workspace = { id: 'workspace'; activeSpaceId: string; writeSeq: number; dbContractVersion: 2; mode: 'legacy' | 'v2' };
export type Stored<T> = T & { spaceId: string };
export type AnyTable<T> = Table<T>;
