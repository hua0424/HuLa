import "uno.css"
import "@unocss/reset/eric-meyer.css"
import TlbsMap from "tlbs-map-vue"
import { createApp } from "vue"
import { setupI18n } from "@/services/i18n"
import { AppException } from "@/common/exception.ts"
import vResize from "@/directives/v-resize"
import vSlide from "@/directives/v-slide.ts"
import router from "@/router"
import { pinia } from "@/stores"
import { initializePlatform, isIOS, isMobile } from "@/utils/PlatformConstants"
import { startWebVitalObserver } from "@/utils/WebVitalsObserver"
import { invoke } from "@tauri-apps/api/core"
import App from "@/App.vue"

initializePlatform()
startWebVitalObserver()

if (isIOS()) {
  invoke("request_ios_badge_authorization").catch((error) => {
    console.warn("[HuLaBadge] 请求 iOS 角标权限失败", error)
  })
}

import("@/services/webSocketAdapter")

if (process.env.NODE_ENV === "development") {
  import("@/utils/Console.ts").then((module) => {
    module.consolePrint()
  })

  if (isMobile()) {
    import("eruda").then((module) => {
      const eruda = "default" in module ? module.default : module
      eruda.init()
    })
  }
}

if (isMobile()) {
  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", setup)
  } else {
    setup()
  }
}

async function setup() {
  await invoke("set_complete", { task: "frontend" })
}

const app = createApp(App)
app
  .use(router)
  .use(pinia)
  .use(TlbsMap)
  .use(setupI18n)
  .directive("resize", vResize)
  .directive("slide", vSlide)
  .mount("#app")
app.config.errorHandler = (err) => {
  if (err instanceof AppException) {
    console.error(err.message)
    return
  }
  throw err
}
