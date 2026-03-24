// 在最顶部添加
import { registerSW } from 'virtual:pwa-register'
import { createApp } from 'vue'
import './style.css' // 引入咱们的黑白灰 Tailwind 魔法样式！
import App from './App.vue'

registerSW({ immediate: true })
// 唤醒 Vue 实例，并注入到 id="app" 的神龛中！
createApp(App).mount('#app')
