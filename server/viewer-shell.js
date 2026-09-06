// A document policy survives hosting proxies that replace CSP response headers.
export const documentPolicy = "default-src 'self'; script-src 'self'; script-src-attr 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'"

const attribute = (value) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

export function withDocumentPolicy(html) {
  return html.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="${attribute(documentPolicy)}">`)
}

export function isolatedViewerShell(id, viewerHtml) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid presentation identifier.')
  const content = withDocumentPolicy(viewerHtml).replace('<head>', `<head><meta name="presentation-id" content="${id}">`)
  // Slides exist only inside this opaque srcdoc frame, including on a direct visit.
  // There is no standalone renderer HTML route that can escape the frame sandbox.
  return withDocumentPolicy(`<!doctype html><html lang="en"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="robots" content="noindex,nofollow"><meta name="theme-color" content="#0b6b45"><title>Presentation · Completed Projects</title><link rel="icon" href="/favicon-96x96.png" type="image/png" sizes="96x96"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
    <style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#f1f8f4}iframe{width:100%;height:100%;border:0;display:block}</style>
    </head><body><iframe title="PowerPoint slide viewer" sandbox="allow-scripts allow-downloads" allow="fullscreen" allowfullscreen referrerpolicy="no-referrer" srcdoc="${attribute(content)}"></iframe></body></html>`)
}
