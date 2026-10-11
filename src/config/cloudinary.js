// Cloudinary is where destination cover images live. Configured once here so
// nothing else needs the credentials.
//
// The whole feature is optional: a destination with no `img` falls back to its
// two gradient colours on the customer site, so an unconfigured server is a
// working server. `env.hasCloudinary` is what callers check before uploading.
import { v2 as cloudinary } from 'cloudinary';
import env from './env.js';

if (env.hasCloudinary) {
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true, // always hand back an https:// URL
  });
}

export default cloudinary;
