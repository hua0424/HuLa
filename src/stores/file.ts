import { defineStore } from 'pinia'
export const useFileStore = defineStore('file', () => {
  const fileList = ref<any[]>([])
  const addFile = () => {}
  return { fileList, addFile }
})
