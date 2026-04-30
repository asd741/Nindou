<script setup>
import { ref } from 'vue'
import DamageCalc from './components/DamageCalc.vue'
import LuckyDraw from './components/LuckyDraw.vue'

const activeTab = ref('lucky')
const tabs = [
  { key: 'damage', label: '傷害計算' },
  { key: 'lucky',  label: '公會戰福袋' },
]
</script>

<template>
  <div class="app">
    <header class="hd">
      <div class="hd-brand">忍豆風雲4工具箱</div>
      <nav class="tab-bar">
        <button
          v-for="t in tabs" :key="t.key"
          class="tab-btn"
          :class="{ active: activeTab === t.key }"
          @click="activeTab = t.key"
        >{{ t.label }}</button>
      </nav>
    </header>

    <DamageCalc v-show="activeTab === 'damage'" />
    <LuckyDraw  v-show="activeTab === 'lucky'" />

    <footer class="ft">忍豆風雲4工具箱</footer>
  </div>
</template>

<style scoped>
.app {
  max-width: 1000px;
  margin: 0 auto;
  padding-bottom: 48px;
}

.hd {
  background: linear-gradient(135deg, #0a0a12 0%, #12101e 100%);
  border-bottom: 1px solid var(--border);
  padding: 14px 20px 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.hd-brand {
  font-size: 0.7rem;
  color: var(--text3);
  letter-spacing: 0.28em;
  text-transform: uppercase;
  padding-top: 4px;
}

.tab-bar {
  display: flex;
  gap: 2px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 10px;
  padding: 3px;
  border: 1px solid var(--border);
}

.tab-btn {
  padding: 7px 22px;
  border-radius: 7px;
  border: none;
  background: transparent;
  color: var(--text3);
  font-size: 0.86rem;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.18s;
  letter-spacing: 0.04em;
  white-space: nowrap;
}

.tab-btn:hover:not(.active) { color: var(--text2); }

.tab-btn.active {
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 1px 6px rgba(0,0,0,0.4), inset 0 1px rgba(255,255,255,0.05);
}

.ft {
  text-align: center;
  padding: 16px;
  font-size: 0.68rem;
  color: var(--text3);
  border-top: 1px solid var(--border);
}
</style>
