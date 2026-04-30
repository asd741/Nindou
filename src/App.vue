<script setup>
import { ref } from 'vue'
import DamageCalc from './components/DamageCalc.vue'
import LuckyDraw from './components/LuckyDraw.vue'

const activeTab = ref('damage')
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
    <LuckyDraw v-show="activeTab === 'lucky'" />

    <footer class="ft">忍豆風雲4工具箱</footer>
  </div>
</template>

<style scoped>
.app {
  max-width: 900px;
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
  font-size: 0.72rem;
  color: var(--text3);
  letter-spacing: 0.25em;
  text-transform: uppercase;
  padding-top: 4px;
}

.tab-bar { display: flex; }

.tab-btn {
  padding: 9px 22px 8px;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--text3);
  font-size: 0.88rem;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s;
  letter-spacing: 0.04em;
  white-space: nowrap;
}

.tab-btn:hover { color: var(--text2); }
.tab-btn.active { color: var(--gold); border-bottom-color: var(--gold); }

.ft {
  text-align: center;
  padding: 16px;
  font-size: 0.68rem;
  color: var(--text3);
  border-top: 1px solid var(--border);
}
</style>
