import { IsUrl, IsNotEmpty } from 'class-validator';

export class ClassifyHtsFromUrlDto {
  @IsUrl(
    {
      require_tld: false,
      require_protocol: true,
    },
    { message: 'Invalid URL format' },
  )
  @IsNotEmpty({ message: 'URL is required' })
  url: string;
}

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
  extractionMethod?: string;
  usedBrowser?: boolean;
  usedVision?: boolean;
  renderedImageUrl?: string;
  isMultiProductPage?: boolean;
  productCount?: number;
  productCandidates?: UrlProductCandidate[];
}

export class ClassifyUrlResponseDto {
  type: UrlType;
  imageUrl?: string;
  metadata?: UrlMetadata;
  error?: string;
}

export class UrlProductCandidate {
  productName?: string;
  description?: string;
  imageUrl?: string;
  price?: string;
  currency?: string;
  source?: 'structured-data' | 'dom';
}
