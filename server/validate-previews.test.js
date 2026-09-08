import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import JSZip from 'jszip'
import { testJpeg, testPreviews } from './test-previews.js'
import { validateAndExtractPreviewZip } from './validate-previews.js'

async function fixture(t, buffer) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'completed-preview-test-')))
  const archive = path.join(root, 'previews.zip')
  const output = path.join(root, 'extracted')
  await fs.writeFile(archive, buffer)
  t.after(async () => fs.rm(root, { recursive: true, force: true }))
  return { root, archive, output }
}

test('valid preview ZIP extracts a canonical manifest and exact numbered JPEGs', async (t) => {
  const { archive, output } = await fixture(t, await testPreviews())
  const manifest = await validateAndExtractPreviewZip(archive, { expectedSlideCount: 2, outputDir: output })
  assert.deepEqual(manifest, { version: 1, slideCount: 2, width: 1600, height: 900, format: 'jpg' })
  assert.deepEqual(await fs.readdir(path.join(output, 'slides')), ['slide-0001.jpg', 'slide-0002.jpg'])
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(output, 'manifest.json'), 'utf8')), manifest)
})
for (const [name, options, pattern] of [
  ['missing slide', { omit: [2] }, /one preview image for every slide/i],
  ['unexpected file', { extra: { name: 'slides/readme.txt' } }, /unsupported files/i],
  ['manifest count mismatch', { manifest: { slideCount: 1 } }, /does not match/i],
  ['manifest extra field', { manifest: { note: 'unexpected' } }, /unsupported fields/i],
  ['image dimension mismatch', { extra: null }, /dimensions/i],
]) {
  test(`rejects ${name} without retaining extracted files`, async (t) => {
    let buffer
    if (name === 'image dimension mismatch') {
      const zip = new JSZip()
      zip.file('manifest.json', JSON.stringify({ version: 1, slideCount: 2, width: 1600, height: 900, format: 'jpg' }))
      zip.file('slides/slide-0001.jpg', testJpeg())
      zip.file('slides/slide-0002.jpg', testJpeg({ width: 1200, height: 675 }))
      buffer = await zip.generateAsync({ type: 'nodebuffer' })
    } else buffer = await testPreviews(options)
    const { archive, output } = await fixture(t, buffer)
    await assert.rejects(
      validateAndExtractPreviewZip(archive, { expectedSlideCount: 2, outputDir: output }),
      pattern,
    )
    assert.equal(await fs.stat(output).then(() => true, () => false), false)
  })
}

test('rejects path traversal and malformed JPEG content', async (t) => {
  const zip = new JSZip()
  zip.file('manifest.json', JSON.stringify({ version: 1, slideCount: 2, width: 1600, height: 900, format: 'jpg' }))
  zip.file('slides/slide-0001.jpg', Buffer.from('not a jpeg'))
  zip.file('../slide-0002.jpg', testJpeg())
  const { archive, output } = await fixture(t, await zip.generateAsync({ type: 'nodebuffer' }))
  await assert.rejects(
    validateAndExtractPreviewZip(archive, { expectedSlideCount: 2, outputDir: output }),
    /unsafe paths|valid JPEG/i,
  )
  assert.equal(await fs.stat(output).then(() => true, () => false), false)
})
