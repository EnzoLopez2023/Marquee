import { rmSync } from 'node:fs'
import path from 'node:path'
import { DefaultAzureCredential } from '@azure/identity'
import { BlobServiceClient } from '@azure/storage-blob'
import { verifyBackup } from './backup.js'

export async function uploadAndVerifyBackup(
  filePath: string,
  accountUrl: string,
  containerName: string,
) {
  if (!accountUrl || !containerName) throw new Error('Off-host backup storage is not configured')
  const service = new BlobServiceClient(accountUrl, new DefaultAzureCredential())
  const container = service.getContainerClient(containerName)
  const blob = container.getBlockBlobClient(path.basename(filePath))
  const local = await verifyBackup(filePath)
  await blob.uploadFile(filePath, {
    metadata: {
      sha256: local.sha256,
      schema: 'marquee-sqlite-backup-v1',
    },
  })
  const readbackPath = `${filePath}.readback`
  try {
    await blob.downloadToFile(readbackPath)
    const readback = await verifyBackup(readbackPath)
    if (readback.sha256 !== local.sha256 || readback.bytes !== local.bytes) {
      throw new Error('Off-host backup read-back does not match the uploaded database')
    }
    return {
      accountUrl,
      container: containerName,
      blob: blob.name,
      etag: (await blob.getProperties()).etag,
      ...local,
      readbackVerified: true,
    }
  } finally {
    rmSync(readbackPath, { force: true })
  }
}
