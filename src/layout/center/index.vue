<template>
  <main id="center" class="flex flex-col border-r h-full">
    <!-- 顶部搜索栏 -->
    <header class="mt-30px pb-10px flex-1 flex-col-x-center border-b">
      <div class="flex-center gap-5px w-full pr-16px pl-16px box-border">
        <!-- 简化搜索框 -->
        <div class="w-full text-12px bg-gray-100 p-2 rounded">Search placeholder</div>
      </div>
    </header>

    <!-- 列表 -->
    <div id="centerList" class="h-full">
      <router-view v-slot="{ Component }">
        <keep-alive :include="['message']">
          <component :is="Component" />
        </keep-alive>
      </router-view>
    </div>
  </main>
</template>

<script setup lang="ts">
// 简化版 Layout Center
</script>
