import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useGlobalStore = defineStore('global', () => {
  const currentSessionRoomId = ref('')
  const unreadReady = ref(true)
  const unReadMark = ref({
    newMsgUnreadCount: 0,
    newFriendUnreadCount: 0,
    newGroupUnreadCount: 0
  })
  const currentSession = ref<any>(null)
  
  const updateCurrentSessionRoomId = (id: string) => { 
    currentSessionRoomId.value = id 
  }
  const updateGlobalUnreadCount = () => {}
  const setTipVisible = () => {}
  
  return { 
    currentSessionRoomId, 
    unreadReady, 
    unReadMark, 
    currentSession,
    updateCurrentSessionRoomId, 
    updateGlobalUnreadCount,
    setTipVisible
  }
})
