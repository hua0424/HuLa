<template>
  <div class="h-100vh w-100vw">
    <NaiveProvider :message-max="3" :notific-max="3" class="h-full">
      <div class="h-full">
        <router-view />
      </div>
    </NaiveProvider>
  </div>
</template>

<script setup lang="ts">
import { loadLanguage } from '@/services/i18n'
import { isMobile } from '@/utils/PlatformConstants'

const isMobileFlag = isMobile()
</script>
