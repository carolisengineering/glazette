// Builds the binary fixtures the end-to-end specs need. Run: node scripts/make-fixtures.mjs
//
// portrait-rotated.jpg: 40x20 landscape pixels plus an EXIF Orientation of 6
//   (rotate 90 degrees clockwise to display), so a pipeline that honors EXIF
//   stores it as 20x40. Pixels are rendered on a Chromium canvas through
//   Playwright, then an EXIF APP1 segment is spliced in right after the JPEG
//   start-of-image marker.
// sample.heic: just an ISO-BMFF "ftyp" box with brand "heic". Browsers can't
//   decode it, which is what the rejection test relies on.
import fs from 'node:fs'
import { chromium } from '@playwright/test'

const out = new URL('../e2e/fixtures/', import.meta.url)
fs.mkdirSync(out, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage()
const b64 = await page.evaluate(() => {
  const c = document.createElement('canvas')
  c.width = 40
  c.height = 20
  const g = c.getContext('2d')
  g.fillStyle = '#175474'
  g.fillRect(0, 0, 40, 20)
  g.fillStyle = '#EEF1F4'
  g.fillRect(0, 0, 20, 10)
  return c.toDataURL('image/jpeg', 0.9).split(',')[1]
})
await browser.close()
const jpeg = Buffer.from(b64, 'base64')

// APP1 payload: "Exif\0\0", a big-endian TIFF header, and one IFD0 entry
// (tag 0x0112 Orientation, type SHORT, count 1, value 6), then "no next IFD".
const tiff = Buffer.from([
  0x4d,
  0x4d,
  0x00,
  0x2a,
  0x00,
  0x00,
  0x00,
  0x08, // "MM", 42, IFD0 at offset 8
  0x00,
  0x01, // one entry
  0x01,
  0x12,
  0x00,
  0x03,
  0x00,
  0x00,
  0x00,
  0x01,
  0x00,
  0x06,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00, // next IFD: none
])
const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff])
const app1 = Buffer.concat([
  Buffer.from([0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 0xff]),
  body,
])
// Insert straight after SOI (0xFFD8) so EXIF readers find it first.
fs.writeFileSync(
  new URL('portrait-rotated.jpg', out),
  Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]),
)

const heic = Buffer.alloc(24)
heic.writeUInt32BE(24, 0) // box size
heic.write('ftypheic', 4, 'latin1') // box type + major brand
heic.writeUInt32BE(0, 12) // minor version
heic.write('mif1heic', 16, 'latin1') // compatible brands
fs.writeFileSync(new URL('sample.heic', out), heic)
