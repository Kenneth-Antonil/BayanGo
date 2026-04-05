/**
 * BayanGo Backend Core — Storage Helpers
 *
 * Firebase Storage URL generation utilities.
 */

function toPublicDownloadUrl(bucketName, objectPath, token) {
  const encodedPath = encodeURIComponent(objectPath);
  const encodedToken = encodeURIComponent(token);
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodedPath}?alt=media&token=${encodedToken}`;
}

module.exports = {
  toPublicDownloadUrl,
};
