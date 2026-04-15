const path = require("path");
const AWS = require("aws-sdk");

const region = process.env.AWS_REGION || "us-east-1";
const bucket =
  process.env.STUDENT_IMAGES_BUCKET ||
  process.env.AWS_S3_STUDENT_BUCKET ||
  "csvc-image-storage-585212425439-us-east-1-an";

function getS3() {
  return new AWS.S3({ region });
}

function allowedPhotoExt(originalname, mimetype) {
  const ext = path.extname(originalname || "").toLowerCase();
  const allowed = [".jpg", ".jpeg", ".png", ".gif", ".webp"];
  if (allowed.includes(ext)) return ext;
  if (mimetype === "image/png") return ".png";
  if (mimetype === "image/gif") return ".gif";
  if (mimetype === "image/webp") return ".webp";
  return ".jpg";
}

/**
 * Public HTTPS URL for an object in this bucket (virtual-hosted–style).
 */
function publicObjectUrl(key) {
  const b = bucket;
  const r = region;
  return `https://${b}.s3.${r}.amazonaws.com/${key}`;
}

/**
 * Upload student profile image. Returns { imageUrl, key }.
 */
async function uploadStudentImage(buffer, studentId, originalname, mimetype) {
  if (!bucket) {
    throw new Error(
      "STUDENT_IMAGES_BUCKET (or AWS_S3_STUDENT_BUCKET) is not set in the environment"
    );
  }
  const ext = allowedPhotoExt(originalname, mimetype);
  const key = `students/${studentId}${ext}`;
  await getS3()
    .putObject({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: mimetype,
      CacheControl: "max-age=31536000",
    })
    .promise();
  return { imageUrl: publicObjectUrl(key), key };
}

/**
 * Delete object by key (students/...) in the configured bucket.
 */
async function deleteObjectByKey(key) {
  if (!bucket || !key) return;
  try {
    await getS3().deleteObject({ Bucket: bucket, Key: key }).promise();
  } catch (e) {
    // ignore missing / permission issues during cleanup
  }
}

/**
 * If imageUrl points at an object in our bucket, return its S3 key; otherwise null.
 */
function keyFromOurBucketUrl(imageUrl) {
  if (!imageUrl || typeof imageUrl !== "string" || !bucket) return null;
  if (!imageUrl.startsWith("https://")) return null;
  try {
    const u = new URL(imageUrl);
    if (!u.hostname.startsWith(`${bucket}.`) || !u.hostname.includes(".s3.")) {
      return null;
    }
    return decodeURIComponent(u.pathname.replace(/^\//, ""));
  } catch {
    return null;
  }
}

/**
 * Remove the S3 object referenced by a previous imageUrl (if it is in our bucket).
 */
async function deleteStudentImageByUrl(imageUrl) {
  const key = keyFromOurBucketUrl(imageUrl);
  if (key) await deleteObjectByKey(key);
}

/**
 * Fetch object bytes from the configured bucket (for API proxy when objects are not public).
 */
async function getObjectBuffer(key) {
  if (!bucket || !key) return null;
  const data = await getS3()
    .getObject({ Bucket: bucket, Key: key })
    .promise();
  return {
    body: data.Body,
    contentType: data.ContentType || "image/jpeg",
  };
}

module.exports = {
  uploadStudentImage,
  deleteObjectByKey,
  deleteStudentImageByUrl,
  keyFromOurBucketUrl,
  getObjectBuffer,
  getBucketName: () => bucket,
};
