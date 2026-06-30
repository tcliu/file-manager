<script lang="ts">
  import FileManager from '$lib/components/FileManager.svelte';

  let { data } = $props();
</script>

<FileManager
  auth={data.auth}
  uploadDir={data.uploadDir}
  maxZipSize={data.maxZipSize}
  imageExtensions={data.imageExtensions}
  videoExtensions={data.videoExtensions}
  thumbnailSupportedExtensions={data.thumbnailSupportedExtensions}
  lightboxLoadDebounceMs={data.lightboxLoadDebounceMs}
  pageLoadDebounceMs={data.pageLoadDebounceMs}
/>
