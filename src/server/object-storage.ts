import {
	DeleteObjectCommand,
	GetObjectCommand,
	HeadBucketCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";

type ObjectStorageConfig = {
	endpoint: string;
	region: string;
	bucket: string;
	accessKeyId: string;
	secretAccessKey: string;
	forcePathStyle: boolean;
};

let cached:
	| { signature: string; client: S3Client; config: ObjectStorageConfig }
	| undefined;

function loadConfig(): ObjectStorageConfig | null {
	const endpoint = process.env.OBJECT_STORAGE_ENDPOINT?.trim();
	const region = process.env.OBJECT_STORAGE_REGION?.trim();
	const bucket = process.env.OBJECT_STORAGE_BUCKET?.trim();
	const accessKeyId = process.env.OBJECT_STORAGE_ACCESS_KEY_ID?.trim();
	const secretAccessKey = process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY?.trim();
	if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey)
		return null;
	return {
		endpoint,
		region,
		bucket,
		accessKeyId,
		secretAccessKey,
		forcePathStyle: process.env.OBJECT_STORAGE_FORCE_PATH_STYLE === "true",
	};
}

function storage() {
	const config = loadConfig();
	if (!config) return null;
	const signature = JSON.stringify(config);
	if (cached?.signature === signature) return cached;
	const client = new S3Client({
		region: config.region,
		endpoint: config.endpoint,
		forcePathStyle: config.forcePathStyle,
		credentials: {
			accessKeyId: config.accessKeyId,
			secretAccessKey: config.secretAccessKey,
		},
		maxAttempts: 3,
		requestHandler: {
			connectionTimeout: 5_000,
			requestTimeout: 20_000,
		},
	});
	cached = { signature, client, config };
	return cached;
}

export function objectStorageAvailable() {
	return Boolean(loadConfig());
}

export async function objectStorageReady() {
	const target = storage();
	if (!target) return false;
	try {
		await target.client.send(
			new HeadBucketCommand({ Bucket: target.config.bucket }),
			{ abortSignal: AbortSignal.timeout(5_000) },
		);
		return true;
	} catch {
		return false;
	}
}

export async function putPrivateObject(key: string, content: Uint8Array) {
	const target = storage();
	if (!target) throw new Error("Objektspeicher ist nicht eingerichtet");
	await target.client.send(
		new PutObjectCommand({
			Bucket: target.config.bucket,
			Key: key,
			Body: content,
			ContentType: "application/octet-stream",
		}),
	);
}

export async function getPrivateObject(key: string) {
	const target = storage();
	if (!target) throw new Error("Objektspeicher ist nicht eingerichtet");
	const result = await target.client.send(
		new GetObjectCommand({ Bucket: target.config.bucket, Key: key }),
	);
	if (!result.Body) throw new Error("Datei im Objektspeicher ist leer");
	return result.Body.transformToByteArray();
}

export async function deletePrivateObject(key: string) {
	const target = storage();
	if (!target) return;
	await target.client.send(
		new DeleteObjectCommand({ Bucket: target.config.bucket, Key: key }),
	);
}
