import JSZip from 'jszip'

export async function testPresentation({ external = false, active = false, title = 'Presentation preview check' } = {}) {
  const zip = new JSZip()
  const p = 'http://schemas.openxmlformats.org/presentationml/2006/main'
  const a = 'http://schemas.openxmlformats.org/drawingml/2006/main'
  const r = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  zip.file('[Content_Types].xml', `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>`)
  zip.file('_rels/.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${r}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`)
  zip.file('ppt/presentation.xml', `<?xml version="1.0"?><p:presentation xmlns:p="${p}" xmlns:a="${a}" xmlns:r="${r}"><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`)
  zip.file('ppt/_rels/presentation.xml.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${r}/slide" Target="slides/slide1.xml"/><Relationship Id="rId2" Type="${r}/slide" Target="slides/slide2.xml"/></Relationships>`)
  for (let index = 1; index <= 2; index += 1) {
    zip.file(`ppt/slides/slide${index}.xml`, `<?xml version="1.0"?><p:sld xmlns:p="${p}" xmlns:a="${a}" xmlns:r="${r}"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="F7F8F5"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:sp><p:nvSpPr><p:cNvPr id="2" name="Preview title"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="800000" y="1700000"/><a:ext cx="10500000" cy="2500000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="3600" b="1"><a:solidFill><a:srgbClr val="053424"/></a:solidFill><a:latin typeface="Arial"/></a:rPr><a:t>${title} — slide ${index}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`)
  }
  if (external) zip.file('ppt/slides/_rels/slide1.xml.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${r}/image" Target="https://example.invalid/image.png" TargetMode="External"/></Relationships>`)
  if (active) zip.file('ppt/vbaProject.bin', 'not executable test content')
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}
