import { defineStore } from 'pinia'
export const useConfigStore = defineStore('config', () => {
  const config = ref<any>({})
  const getConfig = async () => {}
  return { config, getConfig }
})
