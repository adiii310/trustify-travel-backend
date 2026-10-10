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

/**
 * Itinerary documents. PDF only, and deliberately so: a traveller downloads
 * this onto a phone, and a .docx or .pages file is one they may not be able to
 * open. A PDF renders everywhere.
 */
export const ALLOWED_DOCUMENT_TYPES = ['application/pdf'];
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024; // 10 MB

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

/**
 * Multipart parsing for the single `file` part of an itinerary document.
 *
 * A separate multer instance rather than a looser filter on the image one: the
 * two have different size limits and different accepted types, and widening
 * the image filter would let a PDF be saved as a destination cover.
 */
export const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_DOCUMENT_TYPES.includes(file.mimetype)) return cb(null, true);
    cb(ApiError.badRequest('Itineraries must be a PDF.', [
      { field: 'file', message: 'Only PDF files are accepted.' },
    ]));
  },
}).single('file');

/** Promise wrapper around Cloudinary's callback-style upload stream. */
const uploadBuffer = (buffer, options) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: env.CLOUDINARY_FOLDER, ...options },
      (error, result) => (error ? reject(error) : resolve(result)),
    );
    Readable.from(buffer).pipe(stream);
  });

/** Options for an image: cap the stored size, let Cloudinary pick the format. */
const IMAGE_OPTIONS = {
  resource_type: 'image',
  transformation: [
    { width: MAX_STORED_EDGE, height: MAX_STORED_EDGE, crop: 'limit' },
    { quality: 'auto', fetch_format: 'auto' },
  ],
};

/**
 * Options for a document.
 *
 * `resource_type: 'raw'` rather than `'image'`, which is what Cloudinary would
 * otherwise infer for a PDF. Two reasons: a raw file is delivered byte-for-byte,
 * and — the one that actually bites — Cloudinary accounts block PDF *delivery*
 * under `resource_type: 'image'` by default, so an itinerary uploaded that way
 * uploads fine and then 401s when a traveller opens it.
 */
const DOCUMENT_OPTIONS = { resource_type: 'raw' };

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

  const result = await uploadBuffer(req.file.buffer, IMAGE_OPTIONS);

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
 * POST /api/admin/uploads/document — multipart/form-data, one `file` part.
 *
 * Stores nothing itself: the caller writes the returned `url` and `publicId`
 * onto a record (`pdf` / `pdfId` on a package). The response also carries
 * `downloadUrl`, the same file with Cloudinary's `fl_attachment` flag, so the
 * frontends never have to build that path themselves.
 */
const uploadDocument = asyncHandler(async (req, res) => {
  if (!env.hasCloudinary) {
    throw new ApiError(503, 'File uploads are not configured on this server. Set the CLOUDINARY_* variables in .env.');
  }
  if (!req.file) {
    throw ApiError.badRequest('Choose a PDF to upload.', [
      { field: 'file', message: 'No file received.' },
    ]);
  }

  const result = await uploadBuffer(req.file.buffer, DOCUMENT_OPTIONS);

  ApiResponse.created(
    res,
    {
      url: result.secure_url,
      downloadUrl: attachmentUrl(result.secure_url),
      publicId: result.public_id,
      bytes: result.bytes,
      /** The name the admin's file had, for display. */
      name: req.file.originalname || '',
    },
    'Itinerary uploaded successfully',
  );
});

/**
 * Turn a Cloudinary delivery URL into one that downloads rather than displays.
 *
 * `fl_attachment` goes in the transformation segment, right after `/upload/`.
 * A URL that is not a Cloudinary delivery URL — an admin can paste any https
 * address — is returned untouched rather than mangled.
 */
export function attachmentUrl(url) {
  if (!url.includes('/upload/')) return url;
  if (url.includes('/upload/fl_attachment')) return url;
  return url.replace('/upload/', '/upload/fl_attachment/');
}

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

  // Raw files and images live in separate Cloudinary namespaces, so deleting
  // one with the wrong type silently reports "not found" and leaves the file.
  const resourceType = req.body?.resourceType === 'raw' ? 'raw' : 'image';

  const result = await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
  ApiResponse.ok(
    res,
    { publicId, resourceType, result: result.result },
    'File removed successfully',
  );
});

export default { imageUpload, uploadImage, documentUpload, uploadDocument, destroyImage };
