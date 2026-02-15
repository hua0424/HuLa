import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router"

const routes: Array<RouteRecordRaw> = [
  {
    path: "/",
    redirect: "/chat"
  },
  {
    path: "/chat",
    name: "chat",
    component: () => import("@/views/chat/index.vue")
  },
  {
    path: "/login",
    name: "login",
    component: () => import("@/views/loginWindow/Login.vue")
  }
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes
})

export default router
