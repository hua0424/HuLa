import { defineStore } from 'pinia'
export const useContactStore = defineStore('contacts', () => {
  const list = ref([])
  return { list }
})
