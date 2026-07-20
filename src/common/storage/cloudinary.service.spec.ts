import { CloudinaryService } from './cloudinary.service';

describe('CloudinaryService image optimization signature', () => {
  const prev = { ...process.env };

  beforeEach(() => {
    process.env.CLOUDINARY_CLOUD_NAME = 'demo-cloud';
    process.env.CLOUDINARY_API_KEY = '123456789012345';
    process.env.CLOUDINARY_API_SECRET = 'test-secret';
    process.env.CLOUDINARY_IMAGE_FORMAT = 'webp';
    delete process.env.CLOUDINARY_IMAGE_QUALITY;
  });

  afterAll(() => {
    process.env = prev;
  });

  it('signs format only (no quality) and returns maxBytes for FE', () => {
    const service = new CloudinaryService();
    const defaults = service.getImageOptimizationDefaults();
    expect(defaults).toEqual({ format: 'webp' });
    expect(service.getImageMaxBytes()).toBe(3 * 1024 * 1024);

    const sig = service.createUploadSignature({
      timestamp: 1_700_000_000,
      folder: 'quiz-images',
      includeMaxBytes: true,
      ...defaults,
    });

    expect(sig.format).toBe('webp');
    expect(sig.quality).toBeUndefined();
    expect(sig.maxBytes).toBe(3 * 1024 * 1024);
    expect(sig.maxFileSizeMb).toBe(3);
    expect(sig.signature).toEqual(expect.any(String));
    expect(sig.signature.length).toBeGreaterThan(8);
  });

  it('omits format when CLOUDINARY_IMAGE_FORMAT is empty', () => {
    process.env.CLOUDINARY_IMAGE_FORMAT = '';
    process.env.CLOUDINARY_IMAGE_QUALITY = '';
    const service = new CloudinaryService();
    expect(service.getImageOptimizationDefaults()).toEqual({});

    const sig = service.createUploadSignature({
      timestamp: 1_700_000_000,
      folder: 'quiz-images',
    });
    expect(sig.format).toBeUndefined();
    expect(sig.quality).toBeUndefined();
  });
});
