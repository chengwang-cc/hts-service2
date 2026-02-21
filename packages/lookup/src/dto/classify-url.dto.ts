import { IsUrl, IsNotEmpty } from 'class-validator';

export class ClassifyUrlRequestDto {
  @IsUrl(
    {
      require_tld: false, // Allow localhost URLs for testing
      require_protocol: true,
    },
    { message: 'Invalid URL format' },
  )
  @IsNotEmpty({ message: 'URL is required' })
  url: string;
}

export enum UrlType {
  IMAGE = 'image',
  WEBPAGE = 'webpage',
  PRODUCT = 'product',
  INVALID = 'invalid',
}

export class UrlMetadata {
  title?: string;
  description?: string;
  siteName?: string;
  productName?: string;
  price?: string;
  currency?: string;
}

export class ClassifyUrlResponseDto {
  type: UrlType;
  imageUrl?: string;
  metadata?: UrlMetadata;
  error?: string;
}
