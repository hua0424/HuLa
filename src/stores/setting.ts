import { defineStore } from "pinia"
import { ref } from "vue"

export const useSettingStore = defineStore("setting", () => {
  const page = ref({ shadow: false })
  const notification = ref({ messageSound: false, volume: 80 })
  return { page, notification }
})
