import {
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import { extname } from 'path';

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);
  // null si les identifiants S3 ne sont pas configurés : l'upload renvoie 503
  // au lieu de faire planter le boot de l'API.
  private readonly s3: S3Client | null;
  private readonly bucket: string;
  private readonly publicBase: string;

  constructor(config: ConfigService) {
    const endpoint = config.get<string>('S3_ENDPOINT');
    const accessKeyId = config.get<string>('S3_ACCESS_KEY_ID');
    const secretAccessKey = config.get<string>('S3_SECRET_ACCESS_KEY');
    const region = config.get<string>('S3_REGION') ?? 'us-east-1';
    this.bucket = config.get<string>('S3_BUCKET') ?? 'Images';
    // Base publique pour construire l'URL renvoyée. Pour Supabase Storage :
    // https://<ref>.supabase.co/storage/v1/object/public
    this.publicBase = (config.get<string>('S3_PUBLIC_URL') ?? '').replace(
      /\/$/,
      '',
    );

    if (!endpoint || !accessKeyId || !secretAccessKey) {
      this.logger.warn(
        'S3_ENDPOINT/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY absents : ' +
          "upload d'images désactivé.",
      );
      this.s3 = null;
      return;
    }

    this.s3 = new S3Client({
      endpoint,
      region,
      credentials: { accessKeyId, secretAccessKey },
      // requis pour les endpoints S3-compatibles (Supabase, MinIO…)
      forcePathStyle: true,
    });
  }

  async uploadImage(file: Express.Multer.File): Promise<{ url: string }> {
    if (!this.s3) {
      throw new ServiceUnavailableException(
        "L'upload d'images n'est pas configuré sur ce serveur.",
      );
    }
    const ext = (extname(file.originalname) || '.jpg').toLowerCase();
    const key = `products/${randomUUID()}${ext}`;

    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: file.buffer,
          ContentType: file.mimetype,
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
    } catch (err) {
      this.logger.error(
        { err },
        "Échec de l'upload de l'image vers le bucket S3",
      );
      throw new InternalServerErrorException("Upload de l'image impossible.");
    }

    const base = this.publicBase || `${this.bucket}`;
    return { url: `${base}/${this.bucket}/${key}` };
  }
}
