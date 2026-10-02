<template>
  <main class="user-card">
    <h1>User Information</h1>
    <p>Welcome to our system. Please manage your profile below.</p>
    <button type="button" @click="save">Save Changes</button>
    <button type="button">Cancel Operation</button>
  </main>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const save = () => {
  window.alert(t('feedback.saved'))
}
</script>
