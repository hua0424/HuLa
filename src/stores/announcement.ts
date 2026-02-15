import { defineStore } from 'pinia'
export const useAnnouncementStore = defineStore('announcement', () => {
  const list = ref([])
  return { list }
})
