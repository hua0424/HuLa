import { defineStore } from 'pinia'
export const useUserStatusStore = defineStore('userStatus', () => {
  const status = ref('online')
  return { status }
})
