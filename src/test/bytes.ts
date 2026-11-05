// jsdom's Blob lacks arrayBuffer(), and fake-indexeddb returns stored Blobs as
// empty plain objects (bytes lost). Tests read bytes leniently; the production
// readers are strict.
export function lenientBytes(blob: Blob): Promise<Uint8Array> {
  if (!(blob instanceof Blob)) return Promise.resolve(new Uint8Array(0))
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(blob)
  })
}
