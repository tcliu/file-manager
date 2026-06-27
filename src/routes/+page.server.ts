import type { PageServerLoad } from './$types';
import { getAppConfig, THUMBNAIL_UNSUPPORTED_EXTENSIONS } from '$lib/server/config';
import { IMAGE_EXTENSIONS, VIDEO_EXTENSIONS } from '$lib/server/constants';

export const load: PageServerLoad = async () => {
  const appConfig = getAppConfig();

  return {
    auth: {
      enabled: appConfig.auth.enabled,
      sessionExpiryMs: appConfig.auth.sessionExpiryMs,
      username: appConfig.auth.username,
    },
    uploadDir: appConfig.uploadDir,
    imageExtensions: [...IMAGE_EXTENSIONS],
    videoExtensions: [...VIDEO_EXTENSIONS],
    thumbnailSupportedExtensions: [...IMAGE_EXTENSIONS].filter(ext => !THUMBNAIL_UNSUPPORTED_EXTENSIONS.includes(ext)),
  };
};
