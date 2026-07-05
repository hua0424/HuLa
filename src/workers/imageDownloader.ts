/// <reference lib="webworker" />

type DownloadRequest = {
  /** 实际用于 fetch 的 URL（已签名） */
  url: string
  /** 原始 URL，用于 worker 状态 key 和返回给主线程 */
  originalUrl: string
}

self.addEventListener('message', async (event: MessageEvent<DownloadRequest>) => {
  const { url, originalUrl } = event.data
  const key = originalUrl || url

  if (!url) {
    self.postMessage({ success: false, url: key, error: 'url is required' })
    return
  }

  try {
    const response = await fetch(url)
    if (!response.ok || !response.body) {
      throw new Error(`下载失败: ${response.status} ${response.statusText}`)
    }

    const buffer = await response.arrayBuffer()
    console.log(`[ImageWorker] 文件下载成功: ${url}`)
    self.postMessage({ success: true, url: key, buffer }, [buffer])
  } catch (error) {
    self.postMessage({ success: false, url: key, error: error instanceof Error ? error.message : String(error) })
  }
})
