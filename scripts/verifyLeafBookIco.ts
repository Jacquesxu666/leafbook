import fs from 'node:fs'
import path from 'node:path'
import { REQUIRED_ICO_SIZES, readIcoSizes } from './generateLeafBookIco'

const repositoryRoot = path.resolve(import.meta.dirname, '..')
for (const relativePath of [
  'packages/desktop/static/icon.ico',
  'packages/desktop/build/icons/icon.ico'
]) {
  const sizes = readIcoSizes(fs.readFileSync(path.join(repositoryRoot, relativePath)))
  if (sizes.join(',') !== REQUIRED_ICO_SIZES.join(',')) {
    throw new Error(
      `${relativePath} has ICO layers ${sizes.join(', ')}; expected ${REQUIRED_ICO_SIZES.join(', ')}`
    )
  }
}

console.log(
  `LeafBook ICO files contain ${REQUIRED_ICO_SIZES.length} layers: ${REQUIRED_ICO_SIZES.join(', ')}.`
)
