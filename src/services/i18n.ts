import { createI18n } from "vue-i18n"

const messages = {
  zh: {},
  en: {},
}

export const setupI18n = createI18n({
  legacy: false,
  locale: "zh",
  fallbackLocale: "en",
  messages,
})

export const loadLanguage = async () => {}
