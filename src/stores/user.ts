import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useUserStore = defineStore('user', () => {
  const userInfo = ref<any>({})
  const getUserRoomDir = async () => ''
  const getUserRoomAbsoluteDir = async () => ''
  
  return { userInfo, getUserRoomDir, getUserRoomAbsoluteDir }
})
