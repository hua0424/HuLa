import { defineStore } from "pinia"
import { ref } from "vue"

export const useMenuTopStore = defineStore("menuTop", () => {
  const activeMenu = ref("chat")
  const setActiveMenu = (menu: string) => { activeMenu.value = menu }
  return { activeMenu, setActiveMenu }
})
