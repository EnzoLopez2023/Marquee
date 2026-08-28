import { createBackup, restoreBackup, verifyBackup } from '../lib/recovery/backup.js'
import { uploadAndVerifyBackup } from '../lib/recovery/offhost.js'

const [command, source, destination] = process.argv.slice(2)
if (command === 'backup' && source && destination) {
  console.log(JSON.stringify(await createBackup(source, destination), null, 2))
} else if (command === 'verify' && source) {
  console.log(JSON.stringify(await verifyBackup(source), null, 2))
} else if (command === 'restore' && source && destination) {
  console.log(JSON.stringify(await restoreBackup(source, destination), null, 2))
} else if (command === 'upload' && source) {
  console.log(JSON.stringify(await uploadAndVerifyBackup(
    source,
    process.env.BACKUP_STORAGE_ACCOUNT_URL || '',
    process.env.BACKUP_STORAGE_CONTAINER || '',
  ), null, 2))
} else {
  throw new Error('Usage: recovery <backup|verify|restore|upload> <source> [destination]')
}
