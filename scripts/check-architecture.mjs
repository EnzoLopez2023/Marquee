import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const dependencies = {
  ...pkg.dependencies,
  ...pkg.devDependencies,
}
const forbiddenDependencies = Object.keys(dependencies)
  .filter((name) => /postgres|drizzle|pg-promise|^pg$/.test(name))
if (forbiddenDependencies.length) {
  throw new Error(`Forbidden database dependencies: ${forbiddenDependencies.join(', ')}`)
}

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(target)
    return /\.(?:ts|tsx|mts|mjs)$/.test(entry.name) ? [target] : []
  })
}

for (const file of [...sourceFiles('lib'), ...sourceFiles('server')]) {
  const source = readFileSync(file, 'utf8')
  if (/journal_mode\s*=\s*WAL/i.test(source)) {
    throw new Error(`WAL journal mode is forbidden: ${file}`)
  }
  if (/(?:from|import)\s+['"](?:drizzle|pg|postgres)/.test(source)) {
    throw new Error(`Shared database client is forbidden: ${file}`)
  }
}

console.log('Architecture gate passed: isolated better-sqlite3 with no PostgreSQL, Drizzle, or WAL')
