import { defineStore } from 'pinia'
export const useGroupStore = defineStore('group', () => {
  const list = ref([])
  return { list }
})
