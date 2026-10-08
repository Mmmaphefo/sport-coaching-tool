// Client-side downscaling for athlete profile photos.
//
// Photos are stored in Postgres as data URLs (inline storage survives
// hosting redeploys, unlike files on an ephemeral disk), so they are
// square-cropped and re-encoded small before leaving the browser: 256px is
// plenty for the 88px roster avatar even on retina screens. Quality is
// stepped down until the encoded string is comfortably under the backend's
// size cap, so the JSON body never trips a 413.

const MAX_SOURCE_BYTES = 12 * 1024 * 1024
const TARGET_MAX_CHARS = 60000

export function fileToProfilePhoto(file, size = 256) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type || !file.type.startsWith('image/')) {
      reject(new Error('Choose an image file (JPEG, PNG or WebP)'))
      return
    }
    if (file.size > MAX_SOURCE_BYTES) {
      reject(new Error('That image is too large — choose one under 12MB'))
      return
    }

    const objectUrl = URL.createObjectURL(file)
    const img = new Image()

    img.onload = () => {
      try {
        // Centre square crop of the shortest side.
        const side = Math.min(img.naturalWidth, img.naturalHeight)
        const sx = (img.naturalWidth - side) / 2
        const sy = (img.naturalHeight - side) / 2

        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')

        // Opaque white first so transparent PNGs don't turn black in JPEG.
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, size, size)
        ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size)

        let dataUrl = canvas.toDataURL('image/jpeg', 0.82)
        for (const quality of [0.7, 0.6, 0.5, 0.42]) {
          if (dataUrl.length <= TARGET_MAX_CHARS) break
          dataUrl = canvas.toDataURL('image/jpeg', quality)
        }
        resolve(dataUrl)
      } catch {
        reject(new Error('Could not process that image'))
      } finally {
        URL.revokeObjectURL(objectUrl)
      }
    }

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('Could not read that image'))
    }

    img.src = objectUrl
  })
}
