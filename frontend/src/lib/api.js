const API_URL = import.meta.env.VITE_API_URL

export async function apiRequest(path, { method = 'GET', body, getToken } = {}) {
  const token = await getToken()

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}))
    throw new Error(errorBody.error || `Request failed with status ${res.status}`)
  }

  if (res.status === 204) {
    return null
  }

  return res.json()
}

// Downloads a file (CSV/PDF report) that needs the Authorization header, so a
// plain <a href> won't do. Streams the response into a blob and triggers a
// save-as using the server's Content-Disposition filename when present.
export async function apiDownload(path, { getToken, filename } = {}) {
  const token = await getToken()

  const res = await fetch(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}))
    throw new Error(errorBody.error || `Download failed with status ${res.status}`)
  }

  const blob = await res.blob()
  const disposition = res.headers.get('Content-Disposition') || ''
  const match = disposition.match(/filename="?([^";]+)"?/)
  const name = filename || (match ? match[1] : 'download')

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}