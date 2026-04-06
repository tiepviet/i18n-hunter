<template>
  <div class="user-card">
    <h2>User Information</h2>
    <p>Welcome to our system. Please manage your profile below.</p>
    
    <div class="actions">
      <button @click="save">Save Changes</button>
      <button class="btn-cancel">Cancel Operation</button>
    </div>

    <span v-if="hasError" class="error-msg">You must enter a username before proceeding.</span>
  </div>
</template>

<script setup>
const save = () => {
  console.log("Save button clicked");
  alert("Your data has been submitted successfully!");
}
</script>
