import { defineStore } from 'pinia'

export const useFeedStore = defineStore('feed', () => {
  const unreadCount = ref(0)
  const feedList = ref([])
  const increaseUnreadCount = () => { unreadCount.value++ }
  const decreaseUnreadCount = () => { unreadCount.value = Math.max(0, unreadCount.value - 1) }
  const getLikeList = async () => ({ list: [] })
  return { 
    unreadCount, 
    feedList, 
    increaseUnreadCount, 
    decreaseUnreadCount, 
    getLikeList 
  }
})
