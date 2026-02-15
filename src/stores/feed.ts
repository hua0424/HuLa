import { defineStore } from 'pinia'

export const useFeedStore = defineStore('feed', () => {
  const unreadCount = ref(0)
  const feedList = ref<any[]>([])
  
  const increaseUnreadCount = (count = 1) => { unreadCount.value += count }
  const decreaseUnreadCount = (count = 1) => { unreadCount.value = Math.max(0, unreadCount.value - count) }
  const getLikeList = async (feedId: string) => ({ list: [] })
  const getFeedDetail = async (feedId: string) => ({})

  return { 
    unreadCount, 
    feedList, 
    increaseUnreadCount, 
    decreaseUnreadCount, 
    getLikeList,
    getFeedDetail
  }
})
