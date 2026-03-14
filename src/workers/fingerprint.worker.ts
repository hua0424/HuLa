/// <reference lib="webworker" />

// 检测浏览器特征
const detectBrowserFeatures = async (): Promise<Record<string, boolean>> => {
  const features: Record<string, boolean> = {}

  const checks = {
    webgl: async () => {
      try {
        const canvas = new OffscreenCanvas(1, 1)
        return !!(canvas as any).getContext('webgl')
      } catch {
        return false
      }
    },
    canvas: async () => {
      try {
        const canvas = new OffscreenCanvas(1, 1)
        return !!(canvas as any).getContext('2d')
      } catch {
        return false
      }
    },
    audio: async () => {
      try {
        return !!(self.AudioContext || (self as any).webkitAudioContext)
      } catch {
        return false
      }
    }
  }

  const results = await Promise.all(
    Object.entries(checks).map(async ([key, check]) => {
      try {
        const result = await check()
        return [key, result]
      } catch {
        return [key, false]
      }
    })
  )

  results.forEach(([key, value]) => {
    features[key as string] = value as boolean
  })

  return features
}

// 非安全上下文（HTTP）时 crypto.subtle 不可用，使用 djb2 哈希作为降级方案
const djb2Hash = (str: string): string => {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i)
    hash = hash & hash
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

// 生成设备指纹
const generateFingerprint = async (data: { deviceInfo: any; browserFingerprint: string }): Promise<string> => {
  try {
    const totalStart = performance.now()

    // 2. 浏览器特征检测
    const featureStart = performance.now()
    const browserFeatures = await detectBrowserFeatures()
    const featureTime = performance.now() - featureStart
    console.log(`Worker: 特征检测耗时: ${featureTime.toFixed(2)}ms`)

    // 3. 组合所有特征
    const hashStart = performance.now()
    const combinedFingerprint = JSON.stringify({
      browserFingerprint: data.browserFingerprint,
      deviceInfo: data.deviceInfo,
      browserFeatures,
      timestamp: Date.now()
    })

    // 4. 生成最终指纹（HTTPS 用 SHA-256，HTTP 非安全上下文降级到 djb2）
    let fingerprint: string
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const fingerprintBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(combinedFingerprint))
      fingerprint = Array.from(new Uint8Array(fingerprintBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    } else {
      fingerprint = djb2Hash(combinedFingerprint)
    }
    const hashTime = performance.now() - hashStart
    console.log(`Worker: 哈希计算耗时: ${hashTime.toFixed(2)}ms`)

    const totalTime = performance.now() - totalStart
    console.log(`Worker: 指纹生成总耗时: ${totalTime.toFixed(2)}ms`)

    return fingerprint
  } catch (error) {
    console.error('Worker: ❌ 生成设备指纹失败:', error)
    return ''
  }
}

// 监听主线程消息
self.onmessage = async (e) => {
  const { type, deviceInfo, browserFingerprint } = e.data

  if (type === 'generateFingerprint') {
    const fingerprint = await generateFingerprint({ deviceInfo, browserFingerprint })
    self.postMessage({ type: 'fingerprintGenerated', fingerprint })
  }
}
