import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useGlobalStore = defineStore('global', () => {
  const currentSessionRoomId = ref('')
  const unreadReady = ref(true)
  const unReadMark = ref({ newMsgUnreadCount: 0 })
  
  const updateCurrentSessionRoomId = (id: string) => { currentSessionRoomId.value = id }
  const updateGlobalUnreadCount = () => {}
  const setTipVisible = () => {}
  
  return { 
    currentSessionRoomId, 
    unreadReady, 
    unReadMark, 
    updateCurrentSessionRoomId, 
    updateGlobalUnreadCount,
    setTipVisible
  }
})
