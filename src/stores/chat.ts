import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useChatStore = defineStore('chat', () => {
  const sessionList = ref<any[]>([])
  const chatMessageList = ref<any[]>([])
  
  const getSessionList = async () => {}
  const pushMsg = async () => {}
  const updateSession = () => {}
  const changeRoom = async () => {}
  
  return {
    sessionList,
    chatMessageList,
    getSessionList,
    pushMsg,
    updateSession,
    changeRoom
  }
})
