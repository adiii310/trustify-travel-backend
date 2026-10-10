import { Readable } from 'node:stream';
import multer from 'multer';

import cloudinary from '../../config/cloudinary.js';
import env from '../../config/env.js';
import asyncHandler from '../../utils/asyncHandler.js';
import ApiResponse from '../../utils/ApiResponse.js';
import ApiError from '../../utils/ApiError.js';

/**
 * What a cover image may be.
 *
 * The customer site paints the file into a 170px-tall card and across the
 * destination hero, so a wide landscape crop is what actually reads well:
 * aim for 3:2 (1200x800 or larger). Anything taller than it is wide gets
 * centre-cropped by the card and loses its subject.
 *
 * SVG is deliberately absent — it is a script-bearing format and these files
 * are served straight to browsers.
 */
export const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
export const RECOMMENDED_RATIO = '3:2 landscape, at least 1200x800';

/** Longest edge Cloudinary stores. Bigger than any slot the site has for it. */
const MAX_STORED_EDGE = 1600;

/**
 * Multipart parsing for the single `image` part, buffered in memory.
 *
 * Memory storage rather than disk: the file is forwarded to Cloudinary
 * immediately and never belongs on this server's filesystem, which may be
 * read-only or ephemeral.
 */
export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) return cb(null, true);
    cb(ApiError.badRequest(
      `That file type is not supported. Upload a JPEG, PNG, WebP or AVIF image (${RECOMMENDED_RATIO}).`,
      [{ field: 'image', message: 'Unsupported file type.' }],
    ));
  },
}).single('image');

/** Promise wrapper around Cloudinary's callback-style upload stream. */
const uploadBuffer = (buffer) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: env.CLOUDINARY_FOLDER,
        resource_type: 'image',
        // Normalise on the way in: cap the stored size, let Cloudinary pick the
        // best format and quality for each requesting browser.
        transformation: [
          { width: MAX_STORED_EDGE, height: MAX_STORED_EDGE, crop: 'limit' },
          { quality: 'auto', fetch_format: 'auto' },
        ],
      },
      (error, result) => (error ? reject(error) : resolve(result)),
    );
    Readable.from(buffer).pipe(stream);
  });

/**
 * POST /api/admin/uploads/image — multipart/form-data, one `image` part.
 *
 * Returns the hosted URL and its `publicId`; the caller stores them on the
 * record (`img` / `imgId` on a destination). This endpoint stores nothing
 * itself, so an upload that is never saved just leaves an orphan in Cloudinary.
 */
const uploadImage = asyncHandler(async (req, res) => {
  if (!env.hasCloudinary) {
    throw new ApiError(503, 'Image uploads are not configured on this server. Set the CLOUDINARY_* variables in .env.');
  }
  if (!req.file) {
    throw ApiError.badRequest('Choose an image to upload.', [
      { field: 'image', message: 'No file received.' },
    ]);
  }

  const result = await uploadBuffer(req.file.buffer);

  ApiResponse.created(
    res,
    {
      url: result.secure_url,
      publicId: result.public_id,
      width: result.width,
      height: result.height,
      format: result.format,
      bytes: result.bytes,
    },
    'Image uploaded successfully',
  );
});

/**
 * POST /api/admin/uploads/destroy — remove a previously uploaded image.
 *
 * `publicId` contains slashes (it carries the folder), which is why this is a
 * POST with a JSON body rather than a DELETE with the id in the path.
 * Deleting an id that is already gone is not an error: the caller's goal —
 * "this image is not hosted any more" — is satisfied either way.
 */
const destroyImage = asyncHandler(async (req, res) => {
  if (!env.hasCloudinary) {
    throw new ApiError(503, 'Image uploads are not configured on this server. Set the CLOUDINARY_* variables in .env.');
  }

  const publicId = String(req.body?.publicId || '').trim();
  if (!publicId) {
    throw ApiError.badRequest('Supply the publicId of the image to remove.', [
      { field: 'publicId', message: 'Required.' },
    ]);
  }

  const result = await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
  ApiResponse.ok(res, { publicId, result: result.result }, 'Image removed successfully');
});

export default { imageUpload, uploadImage, destroyImage };
