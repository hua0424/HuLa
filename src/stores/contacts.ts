import { defineStore } from 'pinia'

export const useContactStore = defineStore('contacts', () => {
  const list = ref([])
  const applyList = ref([])
  return { list, applyList }
})
