import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useChatStore = defineStore('chat', () => {
  const sessionList = ref<any[]>([])
  const chatMessageList = ref<any[]>([])
  
  const getSessionList = async () => {}
  const pushMsg = async () => {}
  const updateSession = () => {}
  const changeRoom = async () => {}
  const getSession = (id: string) => ({ unreadCount: 0 })
  const markSessionRead = (id: string) => {}
  const getMessage = (id: string) => ({})
  const updateMsg = (msg: any) => {}
  
  return {
    sessionList,
    chatMessageList,
    getSessionList,
    pushMsg,
    updateSession,
    changeRoom,
    getSession,
    markSessionRead,
    getMessage,
    updateMsg
  }
})
