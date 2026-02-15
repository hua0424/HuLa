import { defineStore } from 'pinia'
export const useUserStore = defineStore('user', () => {
  const userInfo = ref<any>({})
  return { userInfo }
})
