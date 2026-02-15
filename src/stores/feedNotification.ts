import { defineStore } from 'pinia'
export const useFeedNotificationStore = defineStore('feedNotification', () => {
  const list = ref([])
  return { list }
})
