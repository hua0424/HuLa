import { defineStore } from 'pinia'
export const useLoginHistoryStore = defineStore('loginHistory', () => {
  const history = ref<any[]>([])
  return { history }
})
