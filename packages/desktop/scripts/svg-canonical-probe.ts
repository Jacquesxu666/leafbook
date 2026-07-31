import { createHash } from 'node:crypto'
import { sanitizeBookSvg } from '../src/main/book/svgSanitizer'

const source =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-10 -10 20 20" height="20" width="20"><defs><linearGradient spreadMethod="pad" x2="100%" x1="0%" gradientUnits="userSpaceOnUse" id="paint" gradientTransform="translate(1 2)"><stop stop-opacity="1" stop-color="#fff" offset="0"/></linearGradient></defs><circle r="4" cy="0" cx="0" fill="url(#paint)"/><path stroke-width="1" stroke="#000" d="M0 0L1 1"/></svg>'
const result = sanitizeBookSvg(new TextEncoder().encode(source))
if (!result) process.exitCode = 1
else process.stdout.write(`${createHash('sha256').update(result.bytes).digest('hex')}\n`)
