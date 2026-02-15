import { defineStore } from 'pinia'
export const useFeedStore = defineStore('feed', () => {
  const unreadCount = ref(0)
  return { unreadCount }
})
