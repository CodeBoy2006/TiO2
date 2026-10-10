import { createApp } from 'vue'
import App from './App.vue'
import './style.css'
import { language } from './i18n'

document.documentElement.lang = language
createApp(App).mount('#app')
