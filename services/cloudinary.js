const cloudinary = require('cloudinary').v2;
const {
  upload,
  galleryUpload,
  deleteFromGridFS,
  streamGridFSFile
} = require('./mongoStorage');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || '',
  api_key: process.env.CLOUDINARY_API_KEY || '',
  api_secret: process.env.CLOUDINARY_API_SECRET || ''
});

module.exports = {
  cloudinary,
  upload,
  galleryUpload,
  deleteFromGridFS,
  streamGridFSFile
};

