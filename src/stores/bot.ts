import { defineStore } from 'pinia'
export const useBotStore = defineStore('bot', () => {
  const list = ref([])
  return { list }
})
