import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const bucketName = String(process.env.AWS_STORAGE_BUCKET_NAME || "").trim();
const regionName = String(process.env.AWS_S3_REGION_NAME || "").trim();

export type StoredS3Attachment = {
  storage: "s3";
  bucket: string;
  key: string;
  name: string;
  type: string;
  size: number;
};

let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!bucketName || !regionName) {
    throw Object.assign(new Error("S3 storage is not configured."), {
      errorCode: "S3_NOT_CONFIGURED",
      httpStatus: 500,
    });
  }
  if (!s3Client) {
    s3Client = new S3Client({
      region: regionName,
    });
  }
  return s3Client;
}

export function sanitizeFileName(name: string): string {
  const trimmed = String(name || "").trim();
  const sanitized = trimmed.replace(/[^a-zA-Z0-9._-]/g, "_");
  return sanitized || "attachment";
}

export async function uploadFileToS3(input: {
  key: string;
  body: Buffer;
  contentType: string;
  originalName: string;
  contentLength: number;
}): Promise<StoredS3Attachment> {
  const client = getS3Client();
  await client.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: input.key,
    Body: input.body,
    ContentType: input.contentType,
    ContentDisposition: `inline; filename="${sanitizeFileName(input.originalName)}"`,
  }));

  return {
    storage: "s3",
    bucket: bucketName,
    key: input.key,
    name: input.originalName,
    type: input.contentType,
    size: input.contentLength,
  };
}

export async function deleteFileFromS3(key: string | null | undefined): Promise<void> {
  const trimmed = String(key || "").trim();
  if (!trimmed) return;
  const client = getS3Client();
  await client.send(new DeleteObjectCommand({
    Bucket: bucketName,
    Key: trimmed,
  }));
}

export async function createSignedReadUrl(key: string, fileName?: string | null, contentType?: string | null): Promise<string> {
  const client = getS3Client();
  return getSignedUrl(client, new GetObjectCommand({
    Bucket: bucketName,
    Key: key,
    ResponseContentDisposition: fileName ? `inline; filename="${sanitizeFileName(fileName)}"` : undefined,
    ResponseContentType: contentType || undefined,
  }), {
    expiresIn: 60 * 15,
  });
}

export async function headS3Object(key: string) {
  const client = getS3Client();
  return client.send(new HeadObjectCommand({
    Bucket: bucketName,
    Key: key,
  }));
}

export function getS3BucketName(): string {
  return bucketName;
}
