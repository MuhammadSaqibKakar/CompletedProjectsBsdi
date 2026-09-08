import JSZip from 'jszip'

export function testJpeg({ width = 1600, height = 900, marker = 0 } = {}) {
  const bytes = Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >>> 8) & 0xff, height & 0xff,
    (width >>> 8) & 0xff, width & 0xff,
    0x03,
    0x01, 0x11, 0x00,
    0x02, 0x11, 0x00,
    0x03, 0x11, marker & 0xff,
    0xff, 0xd9,
  ])
  return bytes
}
export async function testPreviews({
  slideCount = 2,
  width = 1600,
  height = 900,
  manifest = {},
  omit = [],
  extra = null,
  markerOffset = 0,
} = {}) {
  const zip = new JSZip()
  zip.file('manifest.json', JSON.stringify({ version: 1, slideCount, width, height, format: 'jpg', ...manifest }))
  for (let number = 1; number <= slideCount; number += 1) {
    if (!omit.includes(number)) {
      zip.file(`slides/slide-${String(number).padStart(4, '0')}.jpg`, testJpeg({ width, height, marker: number + markerOffset }))
    }
  }
  if (extra) zip.file(extra.name, extra.bytes || Buffer.from('extra'))
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}
