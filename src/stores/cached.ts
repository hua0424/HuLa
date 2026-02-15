import { defineStore } from 'pinia'
export const useCachedStore = defineStore('cached', () => {
  const userCachedList = ref<any>({})
  const filterUsers = async () => []
  return { userCachedList, filterUsers }
})
