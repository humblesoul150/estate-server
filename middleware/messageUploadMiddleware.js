const multer = require("multer");

const allowedTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "video/mp4",
  "video/quicktime",
  "application/pdf",
  "text/plain",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, callback) => {
    if (!allowedTypes.has(file.mimetype)) {
      return callback(new Error("Unsupported attachment type."));
    }
    return callback(null, true);
  },
});

module.exports = (req, res, next) => {
  upload.single("attachment")(req, res, (error) => {
    if (!error) return next();
    const status = error instanceof multer.MulterError ? 413 : 415;
    return res.status(status).json({ message: error.message });
  });
};
