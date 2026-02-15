export const useWindow = () => {
  const createWebviewWindow = async (title: string, label: string, width: number, height: number) => {}
  const resizeWindow = async (label: string, width: number, height: number) => {}
  const setResizable = async (resizable: boolean) => {}
  const checkWinExist = async (label: string) => false
  const getWindowPayload = async () => ({})
  return { 
    createWebviewWindow, 
    resizeWindow, 
    setResizable, 
    checkWinExist,
    getWindowPayload
  }
}
